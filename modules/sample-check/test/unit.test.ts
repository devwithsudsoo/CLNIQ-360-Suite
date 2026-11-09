import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@clniq/kit";
import { MODULE_KEY, SCHEMA } from "../src/server.js";

const manifest = JSON.parse(readFileSync(new URL("../clniq.module.json", import.meta.url), "utf8"));

describe("sample-check unit", () => {
  it("registry record matches the module and the C1 shape", () => {
    expect(manifest.key).toBe(MODULE_KEY);
    expect(manifest.schema).toBe(SCHEMA);
    for (const k of ["key", "name", "kind", "version", "depends_on", "channels", "default_quota", "health_url", "ui_entry"]) expect(manifest).toHaveProperty(k);
    expect(["core", "addon", "adhoc"]).toContain(manifest.kind);
    expect(manifest.depends_on).toContain("core");
  });

  it("cursor round-trips", () => {
    const c = encodeCursor({ ts: "2026-01-01T00:00:00.000Z", id: "x" });
    expect(decodeCursor(c)).toEqual({ ts: "2026-01-01T00:00:00.000Z", id: "x" });
  });

  it("missing or empty cursor means first page", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("malformed cursors are rejected as 400 problems, not crashes", () => {
    for (const bad of ["%%%", Buffer.from("not json").toString("base64url"), "a"]) {
      expect(() => decodeCursor(bad)).toThrow(expect.objectContaining({ status: 400, code: "invalid-cursor" }));
    }
  });

  it("registry quota and channels are sane", () => {
    expect(Number.isInteger(manifest.default_quota) && manifest.default_quota > 0).toBe(true);
    expect(manifest.channels.length).toBeGreaterThan(0);
    for (const c of manifest.channels) expect(["UI", "API"]).toContain(c);
  });
});
