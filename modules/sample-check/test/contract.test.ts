import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { rulesFromOpenApi } from "@clniq/gateway";
import { MODULE_KEY } from "../src/server.js";

type Op = { "x-permission"?: string; parameters?: unknown[]; responses: Record<string, unknown> };
const specPath = fileURLToPath(new URL("../contract/openapi.yaml", import.meta.url));
const spec = parse(readFileSync(specPath, "utf8")) as { openapi: string; paths: Record<string, Record<string, Op>> };
const ops = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
    .map(([method, op]) => ({ path, method, op }))
);

describe("sample-check contract (R2, R4, R7)", () => {
  it("declares at least one operation (checks below cannot pass vacuously)", () => {
    expect(spec.paths).toBeTypeOf("object");
    expect(ops.length).toBeGreaterThan(0);
  });

  it("gateway refuses an operation without x-permission or with another module's prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "clniq-spec-"));
    const missing = join(dir, "missing.yaml");
    writeFileSync(missing, "openapi: 3.1.0\npaths:\n  /api/v1/sample-check/x:\n    get: { responses: {} }\n");
    expect(() => rulesFromOpenApi(MODULE_KEY, missing)).toThrow(/x-permission/);
    const foreign = join(dir, "foreign.yaml");
    writeFileSync(foreign, "openapi: 3.1.0\npaths:\n  /api/v1/sample-check/x:\n    get: { x-permission: 'other:read', responses: {} }\n");
    expect(() => rulesFromOpenApi(MODULE_KEY, foreign)).toThrow(/x-permission/);
    const empty = join(dir, "empty.yaml");
    writeFileSync(empty, "openapi: 3.1.0\n");
    expect(rulesFromOpenApi(MODULE_KEY, empty)).toEqual([]);
  });

  it("is OpenAPI 3.1 under /api/v1/<module>/", () => {
    expect(spec.openapi).toBe("3.1.0");
    for (const { path } of ops) expect(path.startsWith(`/api/v1/${MODULE_KEY}/`)).toBe(true);
  });
  it("every operation declares x-permission <module>:<action> and compiles into gateway rules", () => {
    for (const { op } of ops) expect(op["x-permission"]).toMatch(new RegExp(`^${MODULE_KEY}:[a-z-]+$`));
    expect(rulesFromOpenApi(MODULE_KEY, specPath)).toHaveLength(ops.length);
  });
  it("every write requires Idempotency-Key; every operation returns RFC 9457 problems", () => {
    for (const { method, op } of ops) {
      if (method !== "get") expect(JSON.stringify(op.parameters ?? [])).toContain("IdempotencyKey");
      expect(JSON.stringify(op.responses.default)).toContain("responses/Problem");
    }
  });
  it("list operations page by cursor", () => {
    for (const { op } of ops.filter((o) => o.method === "get")) expect(JSON.stringify(op.parameters ?? [])).toContain("Cursor");
  });
});
