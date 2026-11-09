// Generates typed SDK definitions for every module OpenAPI spec into packages/sdk (R7: generated SDK).
import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "packages/sdk/src/generated");
mkdirSync(out, { recursive: true });
const specs = [];
for (const area of ["core", "modules"]) {
  const dir = join(root, area);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const spec = join(dir, name, "contract/openapi.yaml");
    if (existsSync(spec)) specs.push({ name, spec });
  }
}
const index = [];
for (const { name, spec } of specs) {
  const ast = await openapiTS(new URL(`file://${spec}`));
  writeFileSync(join(out, `${name}.ts`), `/* generated from ${area(spec)} — do not edit */\n${astToString(ast)}`);
  index.push(`export type * as ${camel(name)} from "./${name}.js";`);
}
writeFileSync(join(out, "index.ts"), `${index.join("\n")}\nexport {};\n`);
console.log(`sdk: generated ${specs.length} module type sets`);

function camel(s) { return s.replace(/-(\w)/g, (_, c) => c.toUpperCase()); }
function area(p) { return p.slice(root.length + 1); }
