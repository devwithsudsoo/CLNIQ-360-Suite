import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventEnvelope } from "@clniq/contracts/events";
import { createDb, InProcessBus, migrate, relayOnce, verifyAuditChain, withTenant, type Db } from "@clniq/kit";
import { freshDatabase, requireDatabaseUrl, testAuth, tokenFor } from "@clniq/kit/testing";
import { buildServer, SCHEMA } from "../src/server.js";

const migrations = fileURLToPath(new URL("../migrations/", import.meta.url));
const t = { tid: randomUUID(), clinic: randomUUID(), practice: randomUUID() };
const ctx = { tenantId: t.tid, clinicIds: [t.clinic], practiceIds: [t.practice], userId: "u", roles: ["doctor"], entV: 1, channel: "UI" as const, correlationId: "c" };
let db: Db;
let drop: () => Promise<void>;

beforeAll(async () => {
  const fresh = await freshDatabase(requireDatabaseUrl(), "alone_sample_check");
  drop = fresh.drop;
  db = createDb(fresh.url);
  await migrate(db, SCHEMA, migrations);
});
afterAll(async () => {
  await db?.end();
  await drop?.();
});

describe("sample-check runs alone with only core (R3)", () => {
  it("migrations are idempotent", async () => {
    expect(await migrate(db, SCHEMA, migrations)).toEqual([]);
  });

  it("boots ready, writes idempotently, relays through the outbox, keeps an intact append-only audit chain", async () => {
    const app = buildServer(db, testAuth);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).json().status).toBe("ok");

    const authorization = `Bearer ${await tokenFor({ tid: t.tid, cids: [t.clinic], pids: [t.practice] })}`;
    const key = randomUUID();
    const body = { clinic_id: t.clinic, practice_id: t.practice, label: "Synthetic" };
    const post = (headers: Record<string, string>, payload: object) => app.inject({ method: "POST", url: "/api/v1/sample-check/records", headers, payload });

    const first = await post({ authorization, "idempotency-key": key }, body);
    expect(first.statusCode).toBe(201);
    const replay = await post({ authorization, "idempotency-key": key }, body);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json().id).toBe(first.json().id);
    expect((await post({ authorization, "idempotency-key": key }, { ...body, label: "Other" })).statusCode).toBe(422);
    expect((await post({ authorization }, body)).statusCode).toBe(400);
    expect((await post({ authorization, "idempotency-key": "short" }, body)).statusCode).toBe(400);
    expect((await post({ authorization, "idempotency-key": randomUUID() }, { ...body, label: "" })).statusCode).toBe(400);

    const bus = new InProcessBus();
    const seen: EventEnvelope[] = [];
    bus.on("SampleCheckRecordCreated", async (e) => void seen.push(e));
    expect(await relayOnce(db, bus, { schema: SCHEMA })).toBe(1);
    expect(await relayOnce(db, bus, { schema: SCHEMA })).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tenant_id).toBe(t.tid);
    expect(seen[0]?.data).toEqual({ record_id: first.json().id });

    const page = await app.inject({ method: "GET", url: "/api/v1/sample-check/records?limit=1", headers: { authorization } });
    expect(page.json().items).toHaveLength(1);
    expect(page.json().page.next_cursor).toBeNull();

    await withTenant(db, ctx, async (tx) => {
      expect(await verifyAuditChain(tx, SCHEMA, t.tid)).toBeNull();
    });
    await expect(withTenant(db, ctx, (tx) => tx.query(`UPDATE ${SCHEMA}.audit_log SET action = 'read'`))).rejects.toThrow();
  });

  it("failed publishes back off and dead-letter after max attempts", async () => {
    const app = buildServer(db, testAuth);
    const authorization = `Bearer ${await tokenFor({ tid: t.tid, cids: [t.clinic], pids: [t.practice] })}`;
    await app.inject({ method: "POST", url: "/api/v1/sample-check/records", headers: { authorization, "idempotency-key": randomUUID() }, payload: { clinic_id: t.clinic, practice_id: t.practice, label: "DLQ" } });
    const failing = { publish: async () => { throw new Error("bus down"); } };
    expect(await relayOnce(db, failing, { schema: SCHEMA, maxAttempts: 1 })).toBe(0);
    const c = await db.connect();
    try {
      const { rows } = await c.query<{ dead: boolean; last_error: string }>(`SELECT dead, last_error FROM ${SCHEMA}.outbox WHERE published_at IS NULL`);
      expect(rows).toEqual([{ dead: true, last_error: "bus down" }]);
    } finally {
      c.release();
    }
  });

  it("unauthenticated and malformed tokens get RFC 9457 problems", async () => {
    const app = buildServer(db, testAuth);
    for (const headers of [{}, { authorization: "Bearer not-a-jwt" }, { authorization: "Basic x" }]) {
      const res = await app.inject({ method: "GET", url: "/api/v1/sample-check/records", headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ status: 401, code: "unauthenticated" });
    }
  });
});
