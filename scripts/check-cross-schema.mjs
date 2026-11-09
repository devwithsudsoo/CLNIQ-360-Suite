// R2: no cross-schema SQL. A module's code and migrations may reference only its own schema, kit.* helpers and pg catalogs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const units = [];
for (const area of ["core", "modules"]) {
  const dir = join(root, area);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const manifest = join(dir, name, "clniq.module.json");
    if (existsSync(manifest)) units.push({ dir: join(dir, name), schema: JSON.parse(readFileSync(manifest, "utf8")).schema });
  }
}
const allSchemas = new Set(units.map((u) => u.schema));
const ref = /\b(?:from|join|into|update|references|table|on|truncate)\s+"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?[a-z_]/gi;
const violations = [];
const walk = (d, fn) => {
  for (const e of readdirSync(d)) {
    if (["node_modules", "dist", "generated"].includes(e)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, fn);
    else if (/\.(sql|ts|mjs|js)$/.test(e)) fn(p);
  }
};
for (const u of units) {
  walk(u.dir, (file) => {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(ref)) {
      const schema = m[1].toLowerCase();
      if (allSchemas.has(schema) && schema !== u.schema) violations.push(`${relative(root, file)}: references schema "${schema}" (own schema is "${u.schema}")`);
    }
  });
}
if (violations.length) {
  console.error(`Cross-schema SQL is not allowed (use /api/v1/<m>/* or events):\n${violations.join("\n")}`);
  process.exit(1);
}
console.log(`cross-schema check: ${units.length} units clean`);
