// C0 acceptance: `pnpm new:module <key> "<Name>" [schema]` generates a module that builds and passes every gate.
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [key, name, schemaArg] = process.argv.slice(2);
if (!key || !name || !/^[a-z][a-z0-9-]*$/.test(key)) {
  console.error('usage: new-module.mjs <key: lowercase, dashes> "<Display name>" [schema]');
  process.exit(2);
}
const schema = schemaArg ?? key.replace(/-/g, "_");
if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
  console.error(`schema "${schema}" must be a lowercase SQL identifier`);
  process.exit(2);
}
const root = resolve(import.meta.dirname, "..");
const dest = join(root, "modules", key);
if (existsSync(dest)) {
  console.error(`modules/${key} already exists`);
  process.exit(1);
}
const pascal = key.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
cpSync(join(root, "scripts/templates/module"), dest, { recursive: true });
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else writeFileSync(p, readFileSync(p, "utf8").replaceAll("__KEY__", key).replaceAll("__NAME__", name).replaceAll("__SCHEMA__", schema).replaceAll("__PASCAL__", pascal));
  }
};
walk(dest);
console.log(`created modules/${key} (schema ${schema}). Next: pnpm install && pnpm ci`);
