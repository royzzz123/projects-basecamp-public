/**
 * SEBI Chat Server
 *
 * Orchestrates an agentic loop between the FE widget, the LLM gateway, and the
 * MongoDB MCP client. On startup it:
 *   1. Spawns @mongodb-js/mongodb-mcp-server via stdio.
 *   2. Explicitly calls the `connect` tool with SEBI_MONGO_URI so the MCP has
 *      a live connection before any user request arrives.
 *   3. Discovers available collections and injects them into the system prompt.
 *
 * On each chat request it runs the tool-calling loop until the LLM produces a
 * final text answer, then streams it back to the FE via SSE.
 *
 * Env vars:
 *   SEBI_MONGO_URI   — MongoDB connection string (kubectl port-forward of SEBI VM)
 *   LLM_GATEWAY_URL  — Bifrost/LiteLLM gateway base URL (default: http://localhost:4000)
 *   LLM_MODEL        — model in provider/model format (default: anthropic/claude-sonnet-4-6)
 *   PORT             — port this server listens on (default: 3001)
 */

import { createServer } from "http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LLM_GATEWAY = process.env.LLM_GATEWAY_URL ?? "http://localhost:4000";
const LLM_MODEL   = process.env.LLM_MODEL        ?? "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0";
const MONGO_URI   = process.env.SEBI_MONGO_URI;
const PORT        = Number(process.env.PORT ?? 3001);
const MAX_TOOL_ROUNDS = 6;

// Tools the LLM is allowed to call — no connect/disconnect/write/atlas tools
const ALLOWED_TOOLS = new Set([
  "list-databases",
  "list-collections",
  "collection-schema",
  "collection-indexes",
  "collection-storage-size",
  "db-stats",
  "count",
  "find",
  "aggregate",
  "explain",
]);

if (!MONGO_URI) {
  console.error("SEBI_MONGO_URI is required.");
  console.error("Set it to the SEBI VM MongoDB port-forward URI, e.g.:");
  console.error("  mongodb://root:<pass>@localhost:27017/SEBI-project?authSource=admin&directConnection=true");
  console.error("NOTE: this must be the SEBI kubectl port-forward, NOT portforward-services.sh (OnFinance).");
  process.exit(1);
}

// ── MCP client bootstrap ───────────────────────────────────────────────────

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@mongodb-js/mongodb-mcp-server"],
  env: {
    ...process.env,
    MDB_MCP_CONNECTION_STRING: MONGO_URI,
    MDB_MCP_READ_ONLY: "true",
  },
});

const mcp = new Client({ name: "sebi-chat-server", version: "1.0.0" });
await mcp.connect(transport);

// Explicitly connect — the env var alone doesn't guarantee a live session
const connectResult = await mcp.callTool({
  name: "connect",
  arguments: { connectionString: MONGO_URI },
});
console.log("MongoDB:", connectResult.content?.[0]?.text ?? "connected");

// Discover collections so we can mention them in the system prompt
let knownCollections = "";
try {
  const colResult = await mcp.callTool({
    name: "list-collections",
    arguments: { database: "SEBI-project" },
  });
  knownCollections = colResult.content?.[0]?.text ?? "";
  console.log("SEBI-project collections:", knownCollections);
} catch {
  console.warn("Could not list collections — system prompt will be generic.");
}

// Build tool list — filtered to read-only data tools only
const { tools: mcpTools } = await mcp.listTools();
const allowedMcpTools = mcpTools.filter((t) => ALLOWED_TOOLS.has(t.name));
console.log(`Exposing ${allowedMcpTools.length} tools to LLM: ${allowedMcpTools.map((t) => t.name).join(", ")}`);

const openAITools = allowedMcpTools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description ?? "",
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  },
}));

const SYSTEM_PROMPT = `You are an AI assistant embedded in SEBI's internal complaint management portal.
You have read-only access to the SEBI complaint database. Database: SEBI-project.

COLLECTIONS AND REAL FIELD NAMES (use these exactly):

tt_complaints (17132 docs) — main complaints:
  complaintid, complaint_code, complaint_details,
  complaint_category (category code e.g. "cat8"),
  complaint_sub_category (e.g. "Others"),
  company_name (entity code, e.g. "i00470" — NOT the entity name),
  status, wfstate, created_date, modified_date, date_of_closure

entity_master (20769 docs) — intermediaries/entities:
  userid (entity code — matches tt_complaints.company_name),
  name (human-readable entity name e.g. "ANGEL ONE LIMITED"),
  registrationnumber, categorycode, entitytype, complaint_count (pre-computed total)

category_master (35 docs): code, name
subcategory_master (223 docs): code, name, category_code
tr_complaints (135505 docs) — workflow steps: complaintid, action, remarks, action_date
complaint_summary (5 docs) — AI summaries

QUERY PATTERNS:
- To find complaints by entity name: first find entity_master.userid where name matches (regex), then count tt_complaints where company_name = that userid.
- For quick entity complaint counts: query entity_master directly — the complaint_count field is pre-computed.
- Entity name search: { name: { $regex: "angel one", $options: "i" } }
- Category filter on tt_complaints: { complaint_category: "cat8" }

Always query real data. Never guess numbers. Be concise.`;


// ── LLM helper ────────────────────────────────────────────────────────────

async function callLLM(messages) {
  const res = await fetch(`${LLM_GATEWAY}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      tools: openAITools.length > 0 ? openAITools : undefined,
      max_tokens: 2048,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gateway ${res.status}: ${text}`);
  }
  return res.json();
}

// ── HTTP server ────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404); res.end(); return;
  }

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(JSON.parse(raw)));
      req.on("error", reject);
    });
  } catch {
    res.writeHead(400); res.end(); return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const emit = (content) =>
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);

  try {
    const history = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(body.messages ?? []),
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await callLLM(history);
      const msg = data.choices?.[0]?.message;
      if (!msg) { emit("[No response from LLM]"); break; }

      if (!msg.tool_calls?.length) {
        emit(msg.content ?? "");
        break;
      }

      // Execute tool calls silently — loading dots in the FE handle the wait UX
      history.push(msg);

      for (const tc of msg.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

        let resultContent;
        try {
          const result = await mcp.callTool({ name: tc.function.name, arguments: args });
          resultContent = result.content?.map((c) => c.text ?? JSON.stringify(c)).join("\n") ?? "null";
        } catch (err) {
          resultContent = `Tool error: ${err.message}`;
        }

        console.log(`[${tc.function.name}]`, JSON.stringify(args), "→", resultContent.slice(0, 120));

        history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultContent,
        });
      }
    }
  } catch (err) {
    emit(`\n\nError: ${err.message}`);
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(PORT, () => {
  console.log(`SEBI chat server → http://localhost:${PORT}`);
});
