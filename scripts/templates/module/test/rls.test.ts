import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, migrate, withTenant, type Db, type TenantContext } from "@clniq/kit";
import { freshDatabase, isolationFixture, requireDatabaseUrl, testAuth, tokenFor } from "@clniq/kit/testing";
import { buildServer, SCHEMA } from "../src/server.js";

type Party = ReturnType<typeof isolationFixture>["A"];
const F = isolationFixture();
const scope = (t: Party, practice: string): TenantContext => ({ tenantId: t.tid, clinicIds: [t.clinic], practiceIds: [practice], userId: "u", roles: ["doctor"], entV: 1, channel: "UI", correlationId: "c" });
let db: Db;
let drop: () => Promise<void>;

const insert = (c: TenantContext, label: string) =>
  withTenant(db, c, (tx) => tx.query(`INSERT INTO ${SCHEMA}.records (id, tenant_id, clinic_id, practice_id, label) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), c.tenantId, c.clinicIds[0], c.practiceIds[0], label]));
const labels = (c: TenantContext) => withTenant(db, c, async (tx) => (await tx.query<{ label: string }>(`SELECT label FROM ${SCHEMA}.records ORDER BY label`)).rows.map((r) => r.label));

beforeAll(async () => {
  const fresh = await freshDatabase(requireDatabaseUrl(), "rls___SCHEMA__");
  drop = fresh.drop;
  db = createDb(fresh.url);
  await migrate(db, SCHEMA, fileURLToPath(new URL("../migrations/", import.meta.url)));
  await insert(scope(F.A, F.A.doctorX), "A-X");
  await insert(scope(F.A, F.A.doctorY), "A-Y");
  await insert(scope(F.B, F.B.doctorX), "B-X");
});
afterAll(async () => {
  await db?.end();
  await drop?.();
});

describe("RLS isolation — SQL (R1)", () => {
  it("tenant A never sees tenant B", async () => {
    expect(await labels(scope(F.A, F.A.doctorX))).toEqual(["A-X"]);
    expect(await labels(scope(F.B, F.B.doctorX))).toEqual(["B-X"]);
  });
  it("doctor X never sees doctor Y in the same tenant and clinic", async () => {
    expect(await labels(scope(F.A, F.A.doctorY))).toEqual(["A-Y"]);
  });
  it("empty practice scope sees nothing", async () => {
    expect(await labels({ ...scope(F.A, F.A.doctorX), practiceIds: [] })).toEqual([]);
  });
  it("no scope set at all → no rows (fail closed)", async () => {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE clniq_app");
      expect((await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${SCHEMA}.records`)).rows[0]?.n).toBe(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
  it("cannot write a row into another tenant", async () => {
    await expect(
      withTenant(db, scope(F.A, F.A.doctorX), (tx) =>
        tx.query(`INSERT INTO ${SCHEMA}.records (id, tenant_id, clinic_id, practice_id, label) VALUES ($1,$2,$3,$4,'x')`, [randomUUID(), F.B.tid, F.B.clinic, F.B.doctorX])
      )
    ).rejects.toThrow(/row-level security/);
  });
});

describe("RLS isolation — API (R1)", () => {
  const list = async (t: Party, practice: string) => {
    const res = await buildServer(db, testAuth).inject({ method: "GET", url: "/api/v1/__KEY__/records", headers: { authorization: `Bearer ${await tokenFor({ tid: t.tid, cids: [t.clinic], pids: [practice] })}` } });
    expect(res.statusCode).toBe(200);
    return (res.json().items as Array<{ label: string }>).map((i) => i.label);
  };
  it("tenant A ≠ B and doctor X ≠ Y through the API", async () => {
    expect(await list(F.A, F.A.doctorX)).toEqual(["A-X"]);
    expect(await list(F.A, F.A.doctorY)).toEqual(["A-Y"]);
    expect(await list(F.B, F.B.doctorX)).toEqual(["B-X"]);
  });
  it("a request body cannot widen scope", async () => {
    const res = await buildServer(db, testAuth).inject({
      method: "POST",
      url: "/api/v1/__KEY__/records",
      headers: { authorization: `Bearer ${await tokenFor({ tid: F.A.tid, cids: [F.A.clinic], pids: [F.A.doctorX] })}`, "idempotency-key": randomUUID() },
      payload: { clinic_id: F.A.clinic, practice_id: F.A.doctorY, label: "sneak" }
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});
