import type { TenantContext } from "./context.js";
import type { Tx } from "./db.js";

/** R6 purpose tags. Extend in core (C1 consent ledger) — never free text. */
export type Purpose = "treatment" | "billing" | "operations" | "patient-request" | "legal" | "support" | "analytics";
export type AuditAction = "read" | "create" | "update" | "delete" | "sign" | "export" | "share";

export type AuditEntry = {
  action: AuditAction;
  resourceType: string;
  /** Resource identifier only. Never a name, phone, note or any other PHI value. */
  resourceId: string;
  purpose: Purpose;
  clinicId?: string | null;
  practiceId?: string | null;
};

/** Append to the module's hash-chained audit log inside the caller's tenant transaction. */
export const writeAudit = async (tx: Tx, schema: string, ctx: TenantContext, e: AuditEntry): Promise<void> => {
  await tx.query(
    `INSERT INTO ${schema}.audit_log (tenant_id, clinic_id, practice_id, actor_id, action, resource_type, resource_id, purpose, correlation_id, seq, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, 0, '\\x00', '\\x00')`,
    [ctx.tenantId, e.clinicId ?? null, e.practiceId ?? null, ctx.userId, e.action, e.resourceType, e.resourceId, e.purpose, ctx.correlationId]
  );
};

/** Recomputes the tenant's chain; returns the first broken seq or null when intact. */
export const verifyAuditChain = async (tx: Tx, schema: string, tenantId: string): Promise<number | null> => {
  const { rows } = await tx.query<{ seq: string }>(
    `WITH c AS (
       SELECT seq, hash, prev_hash, lag(hash, 1, '\\x00'::bytea) OVER (ORDER BY seq) AS expected_prev,
              sha256(prev_hash || convert_to(kit.audit_canonical(tenant_id, clinic_id, practice_id, seq, ts, actor_id, action,
                     resource_type, resource_id, purpose, correlation_id), 'UTF8')) AS recomputed,
              row_number() OVER (ORDER BY seq) AS rn
         FROM ${schema}.audit_log WHERE tenant_id = $1)
     SELECT seq FROM c WHERE hash <> recomputed OR prev_hash <> expected_prev OR seq <> rn ORDER BY seq LIMIT 1`,
    [tenantId]
  );
  return rows[0] ? Number(rows[0].seq) : null;
};
