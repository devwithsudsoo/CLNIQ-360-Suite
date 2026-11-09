# Sample Check module (`sample-check`)

Owns schema `sample_check`. API: `/api/v1/sample-check/*` ([contract/openapi.yaml](contract/openapi.yaml)); events: [contract/events.md](contract/events.md). Registry record: [clniq.module.json](clniq.module.json).

- **Run alone:** `DATABASE_URL=… OIDC_ISSUER=… OIDC_AUDIENCE=… OIDC_JWKS_URL=… pnpm --filter @clniq/module-sample-check start` — needs only Postgres and the core identity.
- **Seed (synthetic):** `pnpm --filter @clniq/module-sample-check seed`
- **Tests:** `pnpm test modules/sample-check` — unit, contract, RLS (tenant A≠B, doctor X≠Y, API + SQL) and run-alone.
- **UI:** `ui/index.tsx` exports `mount(el, props)`; stories in Storybook.
- **Rules:** CLAUDE.md R1–R10. No cross-schema SQL; no PHI in logs, tests or events.
