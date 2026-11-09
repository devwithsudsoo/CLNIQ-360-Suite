-- Sample Check owns schema sample_check only (R2). Base tables (outbox, inbox, idempotency, audit) come from @clniq/kit.
CREATE TABLE IF NOT EXISTS sample_check.records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  practice_id uuid NOT NULL,
  label text NOT NULL,
  external_ref jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_page ON sample_check.records (tenant_id, created_at DESC, id DESC);
GRANT SELECT, INSERT, UPDATE ON sample_check.records TO clniq_app;
GRANT SELECT ON sample_check.records TO clniq_ai_ro;
-- RLS from the single kit template (practice scope: doctor X never sees doctor Y's rows). Expanded by kit migrate().
-- @rls sample_check.records practice
