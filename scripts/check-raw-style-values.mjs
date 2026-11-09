// R9 / packaging Part A step 2: no raw colours or px outside packages/design-tokens. Scans UI sources and styles.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SCAN = ["packages/ui/src", "apps", "modules", "integrations", "core"];
const EXT = /\.(css|tsx|jsx|scss)$/;
const RAW = [
  { re: /#[0-9a-fA-F]{3,8}\b/g, what: "hex colour" },
  { re: /\b(rgb|rgba|hsl|hsla)\(/g, what: "colour function" },
  { re: /(?<![\w-])\d+(\.\d+)?px\b/g, what: "px value" }
];
const skip = new Set(["node_modules", "dist", "storybook-static", "generated"]);
const files = [];
const walk = (d) => {
  let entries;
  try { entries = readdirSync(d); } catch { return; }
  for (const e of entries) {
    if (skip.has(e)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.test(e)) files.push(p);
  }
};
for (const s of SCAN) walk(join(root, s));
const hits = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("clniq-allow-raw")) return;
    for (const { re, what } of RAW) for (const m of line.matchAll(re)) hits.push(`${relative(root, f)}:${i + 1} ${what} "${m[0]}"`);
  });
}
if (hits.length) {
  console.error(`Raw style values found (use design tokens):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`raw-style check: ${files.length} files clean`);
