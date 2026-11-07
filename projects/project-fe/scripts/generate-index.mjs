import { readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(root, "dist/client/assets");
const files = readdirSync(assetsDir);

const css = files.find((f) => f.endsWith(".css"));

const entryFile = files.find((f) => {
  if (!f.startsWith("index-") || !f.endsWith(".js")) return false;
  const content = readFileSync(resolve(assetsDir, f), "utf8");
  return content.includes("hydrateRoot") || content.includes("createRoot");
});

if (!entryFile) throw new Error("Could not find app entry JS in dist/client/assets");

// Revert any prior patch — restore hydrateRoot(document, ...) for correct document-level hydration
const entryPath = resolve(assetsDir, entryFile);
let code = readFileSync(entryPath, "utf8");
// Undo previous createRoot patch if present
code = code.replace(
  /(\w+)\.startTransition\(\(\)=>\{\1\.createRoot\(document\.body\)\.render\(/,
  (_, reactVar) => `${reactVar}.startTransition(()=>{${reactVar}.hydrateRoot(document,`,
);
// Fix closing parens: .render(jsx)) → ,jsx))  (hydrateRoot takes 2 args)
writeFileSync(entryPath, code);

// Generate a full SSR-like HTML shell that matches RootShell output exactly.
// hydrateRoot(document, <html>...) needs this structure to hydrate against.
const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OnFinance AI — Complaint Intelligence Dashboard</title>
    ${css ? `<link rel="stylesheet" href="/assets/${css}" />` : ""}
  </head>
  <body>
    <script type="module" src="/assets/${entryFile}"></script>
  </body>
</html>
`;

writeFileSync(resolve(root, "dist/client/index.html"), html);
console.log(`Generated dist/client/index.html (entry: ${entryFile})`);
