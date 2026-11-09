-- Cluster bootstrap shared by core and every module (R1, R5, R6). Idempotent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clniq_app') THEN
    CREATE ROLE clniq_app NOLOGIN NOSUPERUSER NOBYPASSRLS;           -- request path; always under RLS
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clniq_relay') THEN
    CREATE ROLE clniq_relay NOLOGIN NOSUPERUSER NOBYPASSRLS;         -- outbox relay; sees outbox rows only
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clniq_ai_ro') THEN
    CREATE ROLE clniq_ai_ro NOLOGIN NOSUPERUSER NOBYPASSRLS;         -- R5: SELECT only, never granted writes
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS kit;
GRANT USAGE ON SCHEMA kit TO clniq_app, clniq_relay, clniq_ai_ro;

-- Session scope set per transaction from the verified token (SET LOCAL via set_config(...,true)).
-- Unset scope yields NULL, so every policy fails closed.
CREATE OR REPLACE FUNCTION kit.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION kit.current_clinics() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_to_array(nullif(current_setting('app.clinic_ids', true), ''), ',')::uuid[], '{}') $$;
CREATE OR REPLACE FUNCTION kit.current_practices() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(string_to_array(nullif(current_setting('app.practice_ids', true), ''), ',')::uuid[], '{}') $$;

-- Append-only, hash-chained audit (R6). Chain is per tenant per schema; appends are serialised by an advisory lock.
CREATE OR REPLACE FUNCTION kit.audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea; next_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_SCHEMA || ':' || NEW.tenant_id::text, 0));
  EXECUTE format('SELECT hash, seq FROM %I.audit_log WHERE tenant_id = $1 ORDER BY seq DESC LIMIT 1', TG_TABLE_SCHEMA)
    INTO prev, next_seq USING NEW.tenant_id;
  NEW.seq := coalesce(next_seq, 0) + 1;
  NEW.prev_hash := coalesce(prev, '\x00'::bytea);
  NEW.ts := coalesce(NEW.ts, now());
  NEW.hash := sha256(NEW.prev_hash || convert_to(kit.audit_canonical(NEW.tenant_id, NEW.clinic_id, NEW.practice_id, NEW.seq, NEW.ts,
    NEW.actor_id, NEW.action, NEW.resource_type, NEW.resource_id, NEW.purpose, NEW.correlation_id), 'UTF8'));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kit.audit_canonical(t uuid, c uuid, p uuid, s bigint, ts timestamptz, actor text, action text,
  rtype text, rid text, purpose text, corr text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT concat_ws('|', t, coalesce(c::text, ''), coalesce(p::text, ''), s, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     actor, action, rtype, rid, purpose, corr) $$;

CREATE OR REPLACE FUNCTION kit.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
