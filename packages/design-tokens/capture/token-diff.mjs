// Part A step 7: report token drift from clniq.com. Fails if any clniq.com-sourced token disagrees with the capture.
// Provisional tokens are listed so they are visible until replaced by captured values.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const capturedPath = join(root, "capture/captured.json");
const provisional = [];
const checks = [];
const walk = (node, path = []) => {
  if (node && typeof node === "object" && "$value" in node) {
    const src = node.$extensions?.clniq?.source;
    if (src === "provisional") provisional.push(path.join("."));
    if (src === "clniq.com") checks.push({ path: path.join("."), value: String(node.$value).toLowerCase(), evidence: node.$extensions.clniq.evidence });
    return;
  }
  for (const [k, v] of Object.entries(node ?? {})) if (!k.startsWith("$")) walk(v, [...path, k]);
};
for (const f of readdirSync(join(root, "tokens"))) walk(JSON.parse(readFileSync(join(root, "tokens", f), "utf8")));

if (!existsSync(capturedPath)) {
  console.log(`token-diff: no capture yet. clniq.com-sourced: ${checks.length}, provisional: ${provisional.length}`);
  process.exit(0);
}
const cap = JSON.parse(readFileSync(capturedPath, "utf8"));
const theme = cap.schemes?.light?.["1440"]?.themeColor?.toLowerCase();
const drift = checks.filter((c) => c.evidence === "meta theme-color" && theme && c.value !== theme);
for (const d of drift) console.error(`DRIFT ${d.path}: tokens=${d.value} site=${theme}`);
console.log(`token-diff: drift=${drift.length} provisional=${provisional.length}`);
process.exit(drift.length ? 1 : 0);
