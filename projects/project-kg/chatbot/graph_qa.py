"""GraphRAG chatbot over the SCORES knowledge graph (text → Cypher → answer).

A question is turned into ONE read-only Cypher query (LLM #1), executed against
Neo4j, then answered from the actual rows (LLM #2). Strict guardrails reject any
write query, so the chatbot can never mutate the graph. Same Claude Code CLI
inference backend as enrichment.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from config.settings import settings
from enrichment.llm import InferenceError, infer
from graph.driver import run_query

logger = logging.getLogger(__name__)

SCHEMA = """NODE LABELS (key properties):
  Complaint {complaintid, scs, tier (0-3), tier_name, severity (Grave|High|Moderate|None),
    typology, amount_inr, liquidity_block, is_misappropriation, vulnerable, criminal_language,
    market_integrity_risk, senior_mgmt_allegation, class_harm_assertion, distress,
    evidence_quote, state_code, created_date, entity_screenid, hard_triggers (list<string>),
    scored (bool), enriched (bool)}
  Entity {screenid, name, entitytype, categorycode, complaint_count}
  Category {code, name}
  SubCategory {name}
  Typology {name, severity}
  Cluster {cluster_id, kind ('root_cause'|'cross_re_product'), size, n_states, tier, templated_frac, entity_screenid}
  Location {key, state_code, state_name}
  Investor {id_hash}
  TimelineEvent {action, wfstate, role, remarks, at, has_docs}
  Product {key, type, value}

RELATIONSHIPS:
  (Complaint)-[:FILED_AGAINST]->(Entity)
  (Complaint)-[:FILED_BY]->(Investor)
  (Complaint)-[:IN_CATEGORY]->(Category)
  (Complaint)-[:IN_SUBCATEGORY]->(SubCategory)
  (Complaint)-[:LOCATED_IN]->(Location)
  (Complaint)-[:HAS_EVENT]->(TimelineEvent)
  (Complaint)-[:ALLEGES]->(Typology)
  (Complaint)-[:IMPLICATES]->(Product)
  (Complaint)-[:MEMBER_OF]->(Cluster)
  (Cluster)-[:AGAINST]->(Entity)
  (Complaint)-[:SIMILAR_TO]->(Complaint)

NOTES: tier 3=Critical, 2=Priority, 1=Watch, 0=Routine. Only complaints with scored=true have scs/tier.
Escalated = tier >= 2. hard_triggers is a list of strings like "C: 'Grave' typology"."""

CYPHER_SYS = (
    "You convert a question about the SEBI SCORES knowledge graph into ONE read-only Neo4j "
    "Cypher query, using ONLY the given schema. RULES: read-only only (MATCH / OPTIONAL MATCH / "
    "WHERE / WITH / RETURN / ORDER BY / LIMIT — never CREATE/MERGE/SET/DELETE/REMOVE/CALL). ALWAYS "
    "include a LIMIT of 50 or fewer. Return human-readable fields (entity name, typology, scs, "
    "tier_name, evidence_quote, counts) rather than internal ids where possible.\n"
    "ENTITY NAMES: users use abbreviations, short forms and informal names (e.g. 'Zerodha', 'NSE', "
    "'Motilal', 'Groww', 'KFin'). Resolve each to the closest name in KNOWN ENTITIES below and match "
    "with case-insensitive partial match: toLower(e.name) CONTAINS toLower('<distinctive fragment>'). "
    "NEVER require an exact full-name equality. Use the same CONTAINS approach for typologies/categories. "
    "For fraud/scam questions, match Typology names for the relevant conduct.\n"
    'Output STRICT JSON: {"cypher": "<query>", "explanation": "<one sentence>"}.'
)
ANSWER_SYS = (
    "You are a SEBI SCORES analytics assistant. Answer the user's question using ONLY the provided "
    "query results (JSON). Be concise and specific — cite entity names, counts, SCS and tier. If the "
    "results are empty, say no matching records were found. Never invent data beyond the results."
)

_FORBIDDEN = re.compile(r"\b(create|merge|delete|set|remove|detach|drop|foreach|load|call)\b", re.I)
_FENCE = re.compile(r"```(?:json|cypher)?", re.I)


def _extract_json(text: str) -> dict:
    t = _FENCE.sub("", text).replace("```", "").strip()
    s, e = t.find("{"), t.rfind("}")
    if s == -1 or e == -1:
        raise ValueError("no JSON in cypher response")
    return json.loads(t[s : e + 1])


def _is_read_only(cy: str) -> bool:
    if not cy:
        return False
    low = cy.lower()
    return ("match" in low or "return" in low) and not _FORBIDDEN.search(cy)


def _ensure_limit(cy: str) -> str:
    cy = cy.strip().rstrip(";")
    return cy if re.search(r"\blimit\b", cy, re.I) else cy + "\nLIMIT 50"


_ref_cache: str | None = None


def _reference_context() -> str:
    """Real vocabulary from the graph so the LLM can resolve abbreviations / short forms."""
    global _ref_cache
    if _ref_cache is not None:
        return _ref_cache
    ents = run_query("""
        MATCH (e:Entity) WHERE coalesce(e.complaint_count, 0) > 0
        RETURN e.name AS name ORDER BY e.complaint_count DESC LIMIT 180
    """)
    typ = run_query("MATCH (t:Typology) RETURN t.name AS name ORDER BY t.name")
    cats = run_query("MATCH (c:Category) RETURN c.name AS name ORDER BY c.name")
    parts = [
        "KNOWN ENTITIES (map any abbreviation / short form / informal name to the closest EXACT name; "
        "filter with toLower(e.name) CONTAINS toLower('<fragment>')):",
        " | ".join(e["name"] for e in ents if e["name"]),
        "\nTYPOLOGIES (Typology.name):",
        " | ".join(t["name"] for t in typ if t["name"]),
        "\nCATEGORIES (Category.name):",
        " | ".join(c["name"] for c in cats if c["name"]),
        "\nCOMMON ALIASES: NSE → National Stock Exchange; BSE → BSE / Bombay Stock Exchange; "
        "NSDL → National Securities Depository; CDSL → Central Depository Services; "
        "MF → Mutual Fund; RTA / registrar → KFIN or MUFG Intime; broker → entitytype 'intermediary'.",
    ]
    _ref_cache = "\n".join(parts)
    return _ref_cache


async def _gen_cypher(question: str, error: str | None = None) -> tuple[str, str]:
    user = f"Question: {question}\n\nSchema:\n{SCHEMA}\n\n{_reference_context()}\n"
    if error:
        user += f"\nYour previous query failed with error:\n{error}\nReturn a corrected read-only query."
    raw = await infer(CYPHER_SYS, user)
    d = _extract_json(raw)
    return (d.get("cypher") or "").strip(), (d.get("explanation") or "").strip()


async def answer_question(question: str) -> dict:
    question = (question or "").strip()
    if not question:
        return {"answer": "Ask me something about the complaints, entities, typologies, clusters or scores.", "cypher": "", "rows": [], "row_count": 0}

    try:
        cypher, expl = await _gen_cypher(question)
    except (InferenceError, ValueError) as e:
        return {"answer": "Sorry — I couldn't form a query for that.", "cypher": "", "explanation": "", "rows": [], "row_count": 0, "error": str(e)}

    if not _is_read_only(cypher):
        return {"answer": "I can only run read-only queries, and couldn't form a safe one for that question. Try rephrasing.", "cypher": cypher, "explanation": expl, "rows": [], "row_count": 0, "error": "unsafe_query"}

    cypher = _ensure_limit(cypher)
    rows, err = None, None
    for attempt in range(2):
        try:
            rows = await asyncio.to_thread(run_query, cypher)
            break
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
            if attempt == 0:
                try:
                    cypher, expl = await _gen_cypher(question, error=err)
                except (InferenceError, ValueError):
                    break
                if not _is_read_only(cypher):
                    break
                cypher = _ensure_limit(cypher)
    if rows is None:
        return {"answer": "The query couldn't be executed against the graph.", "cypher": cypher, "explanation": expl, "rows": [], "row_count": 0, "error": err}

    rows = rows[:200]
    try:
        ans = await infer(ANSWER_SYS, f"Question: {question}\n\nQuery results (JSON, up to 200 rows):\n{json.dumps(rows, default=str)[:7000]}")
    except InferenceError:
        ans = f"Found {len(rows)} matching record(s)."
    return {"answer": ans.strip(), "cypher": cypher, "explanation": expl, "rows": rows[:50], "row_count": len(rows)}


# ── Per-complaint AI summary (generate once, cache on the node) ────────────
SUMMARY_SYS = (
    "You are a SEBI grievance analyst. In 1-2 short sentences of plain English, explain what this "
    "investor complaint is about and why it matters to a regulator. Be specific and neutral. No "
    "preamble, no bullet points, no markdown headers."
)


async def summarize_complaint(complaint_id: int) -> dict:
    rows = run_query("""
        MATCH (c:Complaint {complaintid: $id})
        OPTIONAL MATCH (c)-[:FILED_AGAINST]->(e:Entity)
        RETURN c.details AS details, c.ai_summary AS cached, c.severity AS sev,
               c.typology AS typ, c.amount_inr AS amt, e.name AS entity
    """, id=complaint_id)
    if not rows:
        return {"summary": None, "error": "complaint not found"}
    r = rows[0]
    if r["cached"]:
        return {"summary": r["cached"], "cached": True}

    details = str(r["details"] or "").strip()
    if not details:
        return {"summary": "No complaint text is available for this record.", "cached": False}

    ctx = (
        f"Entity: {r['entity']}\nSeverity: {r['sev']} · Typology: {r['typ']} · "
        f"Amount: {r['amt']}\n\nComplaint text:\n\"\"\"\n{details[:3000]}\n\"\"\""
    )
    try:
        summary = (await infer(SUMMARY_SYS, ctx)).strip()[:600]
    except InferenceError as e:
        return {"summary": None, "error": str(e)}

    await asyncio.to_thread(
        run_query,
        "MATCH (c:Complaint {complaintid: $id}) SET c.ai_summary = $s, c.ai_summary_model = $m",
        id=complaint_id, s=summary, m=settings.claude_model,
    )
    return {"summary": summary, "cached": False}
