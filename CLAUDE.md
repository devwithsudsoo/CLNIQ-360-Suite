# Clniq 360 agent context
SoT: arch=docs/blueprint.md, build/deploy=docs/packaging.md, visual=https://clniq.com. Read only the § a card cites.
Scope: CLNIQ only. Use no context from any other org, product or project.
Stack: detect from repo; never assume. Layout: /core /modules/<m> /integrations/<i> /apps/{web-shell,admin} /packages/{design-tokens,ui,contracts,sdk}

## MUST
R1 Tenancy: rows carry tenant_id,clinic_id(+practice_id). Postgres RLS; SET app.tenant per txn. Tests: tenant A≠B, doctor X≠Y, API+SQL.
R2 Module: own deployable, schema, migrations. Talk only via /api/v1/<m>/* (OpenAPI 3.1) + outbox events. No cross-schema SQL (CI blocks).
R3 Ports: each dependency = port + adapters {clniq, external (FHIR R4/partner), manual}. Module runs alone with core.
R4 Gate: gateway checks entitlement(tenant,module,channel UI|API,quota) → then RBAC <m>:<action>. UI hides unentitled; server is authority. Entitlements read from core cache keyed ent_v.
R5 AI suggest-only: AI svc has read-only scoped creds; outputs are drafts a human signs; never writes, emits or sends.
R6 Privacy: DPDP Act+Rules 2025, EHR Stds. Consent ledger, purpose tags, append-only hash-chained audit on every PHI read/write, India regions, per-tenant keys. No PHI in logs, tests, telemetry.
R7 API: Idempotency-Key on writes, cursor paging, RFC 9457 errors, expand–contract versioning, generated SDK.
R8 Events: envelope {id,type,v,tenant_id,clinic_id,practice_id,actor,correlation_id,ts,data}; at-least-once; idempotent consumers; signed webhooks out.
R9 UI: only packages/ui + design-tokens (1:1 clniq.com). No raw colours/px. WCAG 2.2 AA. i18n en,ml,hi,ta,kn,te. Micro-frontend, embeddable.
R10 Integration: adapter in /integrations/<i>; per-tenant config; secrets in Key Vault; timeout+retry+DLQ; verify inbound signatures; sandbox mode; health probe; enabled only by entitlement.

## DoD (every card)
OpenAPI+event docs · migrations · unit+contract+RLS+run-alone tests green · Storybook stories · synthetic seed · admin registry entry (C1) · packaging targets build per packaging.md · README ≤1 page.

## Output contract
Plan ≤15 lines, then build. Show diffs, not whole files. Don't restate context or the card. Batch blocking questions in one message; else pick the default and note it. Final report: table item|status|evidence, ≤20 rows.
