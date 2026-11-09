# __NAME__ module (`__KEY__`)

Owns schema `__SCHEMA__`. API: `/api/v1/__KEY__/*` ([contract/openapi.yaml](contract/openapi.yaml)); events: [contract/events.md](contract/events.md). Registry record: [clniq.module.json](clniq.module.json).

- **Run alone:** `DATABASE_URL=… OIDC_ISSUER=… OIDC_AUDIENCE=… OIDC_JWKS_URL=… pnpm --filter @clniq/module-__KEY__ start` — needs only Postgres and the core identity.
- **Seed (synthetic):** `pnpm --filter @clniq/module-__KEY__ seed`
- **Tests:** `pnpm test modules/__KEY__` — unit, contract, RLS (tenant A≠B, doctor X≠Y, API + SQL) and run-alone.
- **UI:** `ui/index.tsx` exports `mount(el, props)`; stories in Storybook.
- **Rules:** CLAUDE.md R1–R10. No cross-schema SQL; no PHI in logs, tests or events.
