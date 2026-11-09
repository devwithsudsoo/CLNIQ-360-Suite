/**
 * Single template for every module schema (blueprint §14: "policies generated from one template").
 * Scope decides which ids a row must match:
 *   tenant   → tenant_id
 *   clinic   → tenant_id + clinic_id ∈ token cids
 *   practice → tenant_id + clinic_id + practice_id ∈ token pids (clinical tables; doctor X ≠ doctor Y)
 */
export type RlsScope = "tenant" | "clinic" | "practice";

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const ident = (name: string): string => {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
};

const predicate = (scope: RlsScope): string => {
  const parts = ["tenant_id = kit.current_tenant()"];
  if (scope !== "tenant") parts.push("clinic_id = ANY (kit.current_clinics())");
  if (scope === "practice") parts.push("practice_id = ANY (kit.current_practices())");
  return parts.join(" AND ");
};

export const rlsPolicySql = (schema: string, table: string, scope: RlsScope): string => {
  const t = `${ident(schema)}.${ident(table)}`;
  const p = predicate(scope);
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ${ident(table)}_isolation ON ${t};`,
    `CREATE POLICY ${ident(table)}_isolation ON ${t} TO clniq_app, clniq_ai_ro USING (${p}) WITH CHECK (${p});`
  ].join("\n");
};

/** Schema, outbox, inbox, idempotency and audit tables every module owns. Idempotent. */
export const baseSchemaSql = (schema: string): string => {
  const s = ident(schema);
  return `
CREATE SCHEMA IF NOT EXISTS ${s};
GRANT USAGE ON SCHEMA ${s} TO clniq_app, clniq_relay, clniq_ai_ro;
CREATE TABLE IF NOT EXISTS ${s}.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS ${s}.outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  clinic_id uuid,
  practice_id uuid,
  type text NOT NULL,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  dead boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS outbox_pending ON ${s}.outbox (next_attempt_at) WHERE published_at IS NULL AND NOT dead;
GRANT INSERT ON ${s}.outbox TO clniq_app;
GRANT SELECT, UPDATE ON ${s}.outbox TO clniq_relay;
${rlsPolicySql(s, "outbox", "tenant")}
DROP POLICY IF EXISTS outbox_relay ON ${s}.outbox;
CREATE POLICY outbox_relay ON ${s}.outbox TO clniq_relay USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ${s}.inbox (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
GRANT SELECT, INSERT ON ${s}.inbox TO clniq_app;
${rlsPolicySql(s, "inbox", "tenant")}

CREATE TABLE IF NOT EXISTS ${s}.idempotency_keys (
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status_code int,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.idempotency_keys TO clniq_app;
${rlsPolicySql(s, "idempotency_keys", "tenant")}

CREATE TABLE IF NOT EXISTS ${s}.audit_log (
  tenant_id uuid NOT NULL,
  seq bigint NOT NULL,
  clinic_id uuid,
  practice_id uuid,
  ts timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  purpose text NOT NULL,
  correlation_id text NOT NULL,
  prev_hash bytea NOT NULL,
  hash bytea NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);
DROP TRIGGER IF EXISTS audit_chain ON ${s}.audit_log;
CREATE TRIGGER audit_chain BEFORE INSERT ON ${s}.audit_log FOR EACH ROW EXECUTE FUNCTION kit.audit_chain();
DROP TRIGGER IF EXISTS audit_immutable ON ${s}.audit_log;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON ${s}.audit_log FOR EACH ROW EXECUTE FUNCTION kit.audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON ${s}.audit_log FROM PUBLIC;
GRANT SELECT, INSERT ON ${s}.audit_log TO clniq_app;
${rlsPolicySql(s, "audit_log", "tenant")}
`;
};
