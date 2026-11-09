// Builds CSS variables, flat JSON (native shells, PDFs, email) and an ESM map from tokens/*.json via Style Dictionary.
// --check validates provenance only (every token declares clniq.com | packaging.md | provisional).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import StyleDictionary from "style-dictionary";

const root = resolve(import.meta.dirname, "..");
const SOURCES = new Set(["clniq.com", "packaging.md", "provisional"]);
const provenance = { "clniq.com": 0, "packaging.md": 0, provisional: 0 };

const walk = (node, path = []) => {
  if (node && typeof node === "object" && "$value" in node) {
    const src = node.$extensions?.clniq?.source;
    if (!SOURCES.has(src)) throw new Error(`token ${path.join(".")} has no valid clniq source`);
    provenance[src]++;
    return;
  }
  for (const [k, v] of Object.entries(node ?? {})) if (!k.startsWith("$")) walk(v, [...path, k]);
};
for (const f of readdirSync(join(root, "tokens"))) walk(JSON.parse(readFileSync(join(root, "tokens", f), "utf8")));
if (process.argv.includes("--check")) {
  console.log(`tokens ok: ${JSON.stringify(provenance)}`);
  process.exit(0);
}

const sd = new StyleDictionary({
  source: [join(root, "tokens/*.json")],
  usesDtcg: true,
  log: { verbosity: "silent" },
  platforms: {
    css: { transformGroup: "css", prefix: "clniq", buildPath: `${join(root, "dist")}/`, files: [{ destination: "tokens.css", format: "css/variables", options: { outputReferences: true } }] },
    json: { transformGroup: "js", buildPath: `${join(root, "dist")}/`, files: [{ destination: "tokens.json", format: "json/flat" }] },
    js: { transformGroup: "js", buildPath: `${join(root, "dist")}/`, files: [{ destination: "tokens.js", format: "javascript/es6" }] }
  }
});
await sd.buildAllPlatforms();
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/provenance.json"), JSON.stringify(provenance, null, 2));
console.log(`design-tokens built: ${JSON.stringify(provenance)}`);
