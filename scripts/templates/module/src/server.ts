import { randomUUID } from "node:crypto";
import { makeEvent } from "@clniq/contracts/events";
import type { FastifyInstance } from "fastify";
import { createModuleServer, decodeCursor, encodeCursor, enqueue, Problem, scoped, withTenant, writeAudit, type AuthConfig, type Db } from "@clniq/kit";

export const MODULE_KEY = "__KEY__";
export const SCHEMA = "__SCHEMA__";

type RecordRow = { id: string; tenant_id: string; clinic_id: string; practice_id: string; label: string; external_ref: Record<string, string>; created_at: Date };
const toApi = (r: RecordRow) => ({ ...r, created_at: r.created_at.toISOString() });

const recordInput = {
  type: "object",
  additionalProperties: false,
  required: ["clinic_id", "practice_id", "label"],
  properties: {
    clinic_id: { type: "string", format: "uuid" },
    practice_id: { type: "string", format: "uuid" },
    label: { type: "string", minLength: 1, maxLength: 200 },
    external_ref: { type: "object", additionalProperties: { type: "string" } }
  }
} as const;

/** Builds the module API. Runs alone with only the core kit (R3); talks to others only via API + outbox (R2). */
export const buildServer = (db: Db, auth: AuthConfig): FastifyInstance => {
  const app = createModuleServer({ key: MODULE_KEY, schema: SCHEMA, db, auth });

  app.get<{ Querystring: { cursor?: string; limit?: number } }>("/api/v1/__KEY__/records", async (req) =>
    scoped(req, (ctx) =>
      withTenant(db, ctx, async (tx) => {
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
        const after = decodeCursor<{ ts: string; id: string }>(req.query.cursor);
        const { rows } = await tx.query<RecordRow>(
          `SELECT id, tenant_id, clinic_id, practice_id, label, external_ref, created_at FROM ${SCHEMA}.records
            WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
            ORDER BY created_at DESC, id DESC LIMIT $3`,
          [after?.ts ?? null, after?.id ?? null, limit + 1]
        );
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        for (const r of page) await writeAudit(tx, SCHEMA, ctx, { action: "read", resourceType: "record", resourceId: r.id, purpose: "operations", clinicId: r.clinic_id, practiceId: r.practice_id });
        return { items: page.map(toApi), page: { next_cursor: rows.length > limit && last ? encodeCursor({ ts: last.created_at.toISOString(), id: last.id }) : null } };
      })
    )
  );

  app.post<{ Body: { clinic_id: string; practice_id: string; label: string; external_ref?: Record<string, string> } }>(
    "/api/v1/__KEY__/records",
    { schema: { body: recordInput } },
    async (req, reply) =>
      scoped(req, async (ctx) => {
        const { clinic_id, practice_id, label, external_ref = {} } = req.body;
        if (!ctx.clinicIds.includes(clinic_id) || !ctx.practiceIds.includes(practice_id)) throw new Problem(403, "Outside your scope", "scope-denied");
        const row = await withTenant(db, ctx, async (tx) => {
          const { rows } = await tx.query<RecordRow>(
            `INSERT INTO ${SCHEMA}.records (id, tenant_id, clinic_id, practice_id, label, external_ref) VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id, tenant_id, clinic_id, practice_id, label, external_ref, created_at`,
            [randomUUID(), ctx.tenantId, clinic_id, practice_id, label, external_ref]
          );
          const created = rows[0]!;
          await writeAudit(tx, SCHEMA, ctx, { action: "create", resourceType: "record", resourceId: created.id, purpose: "operations", clinicId: clinic_id, practiceId: practice_id });
          await enqueue(tx, SCHEMA, makeEvent("__PASCAL__RecordCreated", 1, { tenant_id: ctx.tenantId, clinic_id, practice_id, actor: { kind: "user", id: ctx.userId }, correlation_id: ctx.correlationId }, { record_id: created.id }));
          return created;
        });
        return reply.status(201).send(toApi(row));
      })
  );

  return app;
};
