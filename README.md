# CLNIQ 360

Modular, multi-tenant clinic platform for India. Architecture source of truth: [docs/blueprint.md](docs/blueprint.md); packaging and deployment: [docs/packaging.md](docs/packaging.md); visual reference: https://clniq.com. Rules every change must meet: [CLAUDE.md](CLAUDE.md).

## Stack (detected: none existed, so chosen in C0)
TypeScript on Node 22 LTS · Fastify · PostgreSQL 16 with row-level security · React 18 + Storybook · pnpm workspaces. Versions are pinned in [versions.json](versions.json).

## Layout
`core/` kit (shared runtime) and gateway · `modules/<m>` one deployable per module · `integrations/<i>` adapters · `apps/` web shell and admin · `packages/` design-tokens, ui, contracts, sdk.

## Daily commands
```
pnpm install
pnpm db:up                 # local Postgres (no Docker needed); prints DATABASE_URL
pnpm new:module patient "Patient"   # generate a module from the template
pnpm ci                    # lint gates + typecheck + build + tests (RLS, contract, run-alone)
```
Every module ships its own OpenAPI, events, migrations, seed, UI and tests; see any `modules/<m>/README.md`.

## Design tokens
`packages/design-tokens` is the single source of visual truth. Brand teal `#0d9488` is captured from clniq.com; other values are marked provisional until the monthly Playwright capture (`pnpm --filter @clniq/design-tokens capture`) runs from a network that reaches the site. `diff` fails CI on drift.
