import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testAuth, tokenFor } from "@clniq/kit/testing";
import { checkEntitlement, createGateway, EntitlementCache, MemoryQuotaCounter, StaticEntitlements, StaticPermissions, type EntitlementSource } from "../src/index.js";

const tid = randomUUID();
const rules = [{ method: "GET", pattern: /^\/api\/v1\/demo\/things\/?$/, permission: "demo:read", action: "read" }, { method: "POST", pattern: /^\/api\/v1\/demo\/things\/?$/, permission: "demo:write", action: "write" }];
const enabled = (status: "enabled" | "disabled" = "enabled", channels: ("UI" | "API")[] = ["UI", "API"], api_quota: number | null = null) =>
  new StaticEntitlements({ [tid]: { tenant_id: tid, ent_v: 1, modules: [{ module_key: "demo", status, channels, api_quota, valid_from: null, valid_to: null }] } });
const gw = (source: EntitlementSource, perms = new StaticPermissions({ doctor: ["demo:read", "demo:write"] })) =>
  createGateway({ modules: [{ key: "demo", upstream: "http://127.0.0.1:9", rules }], entitlements: new EntitlementCache(source), permissions: perms, quota: new MemoryQuotaCounter(), auth: testAuth });
const call = async (source: EntitlementSource, method = "GET", chn: "UI" | "API" = "UI", perms?: StaticPermissions) =>
  gw(source, perms).inject({ method, url: "/api/v1/demo/things", headers: { authorization: `Bearer ${await tokenFor({ tid, chn })}` } });

describe("gateway R4: entitlement → RBAC → upstream, fail closed", () => {
  it("401 problem without a token", async () => {
    const res = await gw(enabled()).inject({ method: "GET", url: "/api/v1/demo/things" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
  it("403 when tenant is not entitled", async () => {
    expect((await call(new StaticEntitlements({}))).json().code).toBe("module-not-entitled");
  });
  it("disabled module: reads allowed, writes denied", async () => {
    expect((await call(enabled("disabled"), "POST")).json().code).toBe("module-disabled");
    expect((await call(enabled("disabled"), "GET")).statusCode).toBe(502); // passes the gate; upstream is down
  });
  it("channel not entitled → 403", async () => {
    expect((await call(enabled("enabled", ["UI"]), "GET", "API")).json().code).toBe("channel-not-entitled");
  });
  it("RBAC after entitlement → 403 permission-denied", async () => {
    expect((await call(enabled(), "POST", "UI", new StaticPermissions({ doctor: ["demo:read"] }))).json().code).toBe("permission-denied");
  });
  it("entitlement outage → 503 problem, never allow", async () => {
    const res = await call({ fetch: async () => { throw new Error("down"); } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("entitlements-unavailable");
  });
  it("permission resolver outage → 503 problem", async () => {
    const broken = { permissionsFor: async () => { throw new Error("down"); } } as unknown as StaticPermissions;
    expect((await call(enabled(), "GET", "UI", broken)).json().code).toBe("permissions-unavailable");
  });
  it("unreachable upstream → 502 problem+json", async () => {
    const res = await call(enabled());
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("bad-gateway");
  });
  it("API quota is enforced per day", async () => {
    const q = new MemoryQuotaCounter();
    const ents = { tenant_id: tid, ent_v: 1, modules: [{ module_key: "demo", status: "enabled" as const, channels: ["API" as const], api_quota: 1, valid_from: null, valid_to: null }] };
    expect((await checkEntitlement(ents, "demo", "API", "read", q)).allow).toBe(true);
    expect(await checkEntitlement(ents, "demo", "API", "read", q)).toMatchObject({ allow: false, status: 429 });
  });
});
