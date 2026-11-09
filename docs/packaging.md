CLNIQ Build and Packaging Prompt




  CLNIQ Build and Packaging Prompt
    Nov 8, 2026       ·   ​@Sooraj Sudevan

  One prompt for a coding agent (Claude Code or similar) to produce every CLNIQ package
  from one codebase: one-click installs on Azure Web Apps, Windows and macOS, for the
  whole suite or any single module, styled 1:1 like clniq.com, fetching their own prerequisites
  and updating without downtime.


  How to use it
     1. Open the CLNIQ monorepo in Claude Code (or another repo-aware coding agent)
        with write access and a GitHub Actions + Azure subscription available.
     2. Attach or link the CLNIQ Modular Multi-Tenant Deployment Blueprint — the prompt
        treats it as the architecture source of truth.
     3. Paste the prompt below. The agent plans first and stops for your answers on the open
        decisions before writing code.
     4. Work through its milestones as separate pull requests; each ends with the
        acceptance checks listed in the prompt.

  What you get: a design-token package and UI library captured from clniq.com and
  checked against it by visual tests; container images and native service bundles for every
  module and the core; a "Deploy to Azure" button and azd up onto Azure Web Apps; a
  signed Windows installer and a signed, notarized macOS installer, each offering the full
  suite or any module; and an updater plus release pipeline that patches apps and
  prerequisites on a set cadence without downtime.

  Design choices baked in:

         Clinic PCs and Macs never need Docker; the same services run natively.
         The agent captures clniq.com's exact styles with Playwright, because the site renders
         client-side and its CSS can't be read statically. Brand teal #0d9488 is the one value
         confirmed so far.
         "No downtime" is literal for the app and its runtimes on every target. A local single-
         machine PostgreSQL minor update needs a restart, so it runs in the clinic's
         maintenance window and shows at most a brief pause.




                                                                                              Page 1 of 7
CLNIQ Build and Packaging Prompt




  The prompt
     # Role
     You are a principal platform and design-systems engineer. Build the
     packaging, deployment, update and design system for CLNIQ, a modular, multi-
     tenant clinic platform for India. One codebase must produce installs for
     three targets - Azure Web Apps, Windows and macOS - for the whole suite and
     for each module on its own. Every install is one click or one trigger,
     fetches its own prerequisites, and keeps everything updated with no downtime.
     Every screen must look 1:1 like clniq.com.


     # Source of truth
     - Architecture: the attached "CLNIQ Modular Multi-Tenant Deployment
     Blueprint". Follow it.
       - Core platform (identity, tenancy, RBAC, entitlements, subscriptions,
     lifecycle, audit, numbering) plus modules: patient, visit, billing, case-
     sheet/rx, pharmacy, inventory, payments, reporting.
       - Every module and the core is independently deployable, owns its own
     Postgres schema, talks only through versioned REST APIs and outbox events,
     and runs alone with manual adapters.
       - Multi-tenant with Postgres row-level security on tenant, clinic and
     practice; per-tenant encryption keys.
       - AI is suggest-only: the AI service has read-only scoped credentials and
     can never write records, emit events or send messages.
       - Patient data stays in India; DPDP Act and Rules 2025, EHR Standards and
     medical-record retention apply.
     - Visual design: the live site https://clniq.com is the reference. Where the
     site and any other instruction disagree on looks, the site wins.


     # Step 0 - inspect and plan before writing code
     1. Inspect the repo: languages, frameworks, package managers, existing UI
     code, Dockerfiles, CI, infra, tests. Report the stack; do not assume it.
     2. Write PACKAGING_PLAN.md: target layout, tool choices with one-line
     reasons, milestones, risks.
     3. Stop and ask me about anything that changes the design, at minimum: IaC
     tool (default Bicep + azd), container registry (ACR or GHCR), Windows signing
     (Azure Trusted Signing or an EV certificate), Apple Developer account for
     signing and notarization, release channels, and whether local installs must
     work fully offline.


     # Part A - Design system: 1:1 with clniq.com
     1. Capture the reference. Use Playwright against https://clniq.com at 1440,
     1024, 768 and 390 px wide, light and (if present) dark. Record computed



                                                                               Page 2 of 7
CLNIQ Build and Packaging Prompt




     styles for every distinct element type: colour palette (brand teal #0d9488 is
     the known theme colour; capture all others), font families, weights, sizes,
     line heights and letter spacing, spacing scale, radii, borders, shadows,
     gradients, icon set and stroke width, illustration style, motion (durations,
     easing, hover and focus states), breakpoints and container widths. Save full-
     page reference screenshots per breakpoint. Download the logo and brand assets
     from the site (CLNIQ is our own brand).
     2. Encode it once. Create packages/design-tokens (Style Dictionary or
     equivalent) as the single source: outputs CSS variables, a Tailwind preset
     (or the repo's styling system), and JSON for native shells. No hard-coded
     colours, fonts or spacing anywhere else; a lint rule blocks them.
     3. Build packages/ui: one component library (app shell, navigation, buttons,
     inputs, tables, cards, dialogs, toasts, queue board, case-sheet form, Rx
     printout, invoice and receipt templates, empty and error states) styled only
     from the tokens, documented in Storybook.
     4. Every module's micro-frontend, the core admin, the setup wizard, the
     installer UI where the platform allows, the tray/menu-bar app, emails,
     WhatsApp templates and PDF outputs use packages/ui and the tokens. A module
     run alone looks identical to the same module inside the suite.
     5. Keep the site's voice: calm, clear, lightweight, trustworthy, precise,
     "tailored, austere design". Reuse the site's copy style for empty states and
     onboarding.
     6. Extend without breaking the look: WCAG 2.2 AA contrast and focus states;
     Indian-language text (Malayalam, Hindi, Tamil, Kannada, Telugu) in a font
     family matched to the site's (e.g. Noto Sans scripts) at the same scale;
     print styles for Rx and invoices.
     7. Prove it. Playwright visual-regression tests compare the app shell,
     typography specimen and key components against the captured clniq.com
     references at each breakpoint; a token diff report flags any value that
     drifts from the site. Re-capture monthly and open a PR if clniq.com changed.


     # Part B - Build once, package per target
     - Every module, the core, the AI service and the web shell builds into: (1)
     an OCI container image, and (2) a self-contained native service bundle for
     win-x64, win-arm64, osx-arm64 and osx-x64 (no Docker needed on clinic
     machines).
     - Container images: multi-stage, minimal or distroless base, non-root, read-
     only filesystem, /health/live and /health/ready, multi-arch. SBOM (Syft),
     vulnerability gate (Trivy; fail on critical/high with a fix), signed (cosign
     keyless via GitHub OIDC). Tags: semver + git SHA; deploy by digest.
     - Native bundles: same code, local adapters selected by config - Postgres-
     backed outbox queue instead of Service Bus, in-process cache instead of
     Redis, local disk instead of Blob.



                                                                               Page 3 of 7
CLNIQ Build and Packaging Prompt




     - One versions.json manifest pins every runtime, Postgres, reverse proxy and
     library version for all targets.
     - Docker Compose (profiles: all, core-only, one per module) stays as a
     developer and on-prem server option.


     # Part C - Install targets: whole suite or any single module, one click each
     Module rule for every target: the installer or template offers "Full suite"
     or any set of modules. A module installed alone automatically gets the core
     (identity, tenancy, roles, entitlements, audit). Modules installed later on
     the same machine or Azure environment join the existing core. What actually
     runs is controlled by the tenant's signed entitlement (licence file offline,
     renewed online).


     ## C1 - Azure Web Apps
     - One-click: a "Deploy to Azure" button (ARM compiled from Bicep) plus `azd
     up`, plus a GitHub Actions workflow_dispatch with a module picker for repeat
     deploys.
     - Each module and the core is its own Azure App Service Web App for
     Containers on Linux, with a staging deployment slot, health-check path,
     Always On, autoscale rules and VNet integration. The web shell is its own Web
     App (or Static Web App).
     - Provision with the app: Front Door + WAF, PostgreSQL Flexible Server (zone-
     redundant HA, private endpoint, geo-redundant backup), Azure Cache for Redis,
     Service Bus, Key Vault (referenced from app settings), Storage, Log Analytics
     + App Insights, ACR, managed identities. No secrets in app settings.
     - Parameters: environment, region (default Central India, DR South India),
     modules, SKU. Deploying core + any one module must work; re-running is
     idempotent.


     ## C2 - Windows (single clinic PC or small server)
     - One signed bootstrapper (WiX Burn bundle around per-module MSIs, or
     equivalent). One double-click, no prior setup.
     - It downloads only what is missing, from pinned versions in versions.json,
     verifies SHA-256 and publisher signatures before running anything, and
     installs: runtimes, PostgreSQL (silent, dedicated service account, data under
     ProgramData, LAN closed by default), the reverse proxy with a local
     certificate, each selected module and the core as Windows services, a Start-
     menu shortcut and a system-tray status app. An offline bundle variant
     contains everything.
     - Silent mode for IT (`/quiet` with documented properties: paths, port,
     modules, licence) and a winget manifest.
     - Supported: Windows 10 22H2+, 11, Server 2019+. Preflight checks: OS, disk,
     RAM, ports, pending reboot.



                                                                               Page 4 of 7
CLNIQ Build and Packaging Prompt




     - Secrets in DPAPI, app-level field encryption for clinical data, BitLocker
     warning, encrypted scheduled backup with optional Azure Blob copy. Uninstall
     keeps data unless the user chooses removal after an export.


     ## C3 - macOS (clinic Mac or Mac mini server)
     - One signed and notarized installer: a .pkg (Developer ID Installer,
     notarized and stapled) with a module-selection step, plus a Homebrew cask for
     IT. Universal (Apple Silicon and Intel). macOS 13+.
     - Same behaviour as Windows: downloads missing prerequisites from pinned,
     checksum-verified sources (or uses the offline bundle), installs PostgreSQL,
     the reverse proxy with a local certificate (trusted in the System keychain
     with user consent), each selected module and the core as launchd daemons, an
     app in /Applications and a menu-bar status app.
     - Secrets in the Keychain, FileVault warning, encrypted scheduled backup with
     optional Azure Blob copy, MDM-friendly silent install (`installer -pkg ... -
     target /` with a config profile), clean uninstaller that keeps data unless
     told otherwise.


     # Part D - Keep everything updated, with no downtime
     ## Cadence (industry practice)
     - Critical security fixes (app, runtime, Postgres, proxy, base image):
     released within 72 hours.
     - Monthly patch train aligned to the second Tuesday, covering runtimes and
     dependency patches.
     - App feature releases every 2-4 weeks; runtimes on LTS lines only; support
     the current and previous release (N-1).
     - Renovate (or Dependabot) watches libraries, base images, Actions, Bicep API
     versions and versions.json; patch updates auto-merge when CI is green. All
     images are rebuilt and rescanned at least weekly.
     - Staged rings: internal, pilot clinics, 10%, everyone; a kill switch halts
     any release; automatic halt if error rates rise.


     ## Zero-downtime mechanics
     - Database first: expand-contract migrations only. Each release must run
     against the previous schema and the next; destructive changes wait one
     release.
     - Azure: deploy to the staging slot, warm it up (applicationInitialization +
     health check), run smoke and contract tests, then swap; auto-rollback by
     swapping back on failed health checks. Postgres Flexible Server minor updates
     run in a scheduled maintenance window with zone-redundant HA failover; apps
     reconnect with retry.
     - Windows and macOS (blue-green on one machine): install the new version side
     by side in a versioned folder, start it on alternate ports, health-check it,



                                                                               Page 5 of 7
CLNIQ Build and Packaging Prompt




     then atomically switch the local reverse proxy upstream and drain the old
     version; keep the previous version for instant rollback. Runtime updates ride
     the same switch because each version carries its own runtime.
     - Local PostgreSQL: minor updates need a restart, so apply them in the
     clinic's chosen maintenance window with a pre-update backup; the app queues
     writes and retries so users see at most a brief pause, never an error. Major
     versions upgrade via pg_upgrade, in a window, with a verified backup and
     rollback.
     - Updater (Windows service and macOS launchd daemon): reads a signed release
     manifest (ed25519; TUF-style metadata for key rotation), verifies every
     artefact before use, honours the clinic's ring and window, reports status to
     the tray/menu-bar app and to the tenant admin console, and never updates
     during an active consultation queue unless the fix is critical.


     # CI/CD
     - GitHub Actions with OIDC federation to Azure (no stored credentials).
     Pipelines: build; unit, contract and run-alone tests; cross-schema-query
     check; visual regression against clniq.com references; image build, scan,
     sign, push; native bundles; Windows bundle signed on windows-latest; macOS
     pkg signed, notarized and stapled on macos-latest; Bicep and Helm lint;
     release publication with notes, SBOMs, signatures and migration plan.
     - Version every package from one release tag.


     # Non-negotiables
     - No real patient data in tests, fixtures, logs or telemetry. Telemetry is
     opt-in and scrubbed of personal data.
     - No secrets in code, images or installers.
     - Indian tenants' data stays in Indian regions.
     - Never weaken RLS, tenant isolation, the AI suggest-only rule or the
     clniq.com look to make packaging easier.


     # Acceptance checks (show evidence for each)
     1. Visual regression passes against clniq.com references at all four
     breakpoints; the token diff report shows no drift; a module run alone is
     pixel-identical to the same module in the suite.
     2. Azure: one click into an empty subscription deploys the full suite to Web
     Apps in Central India; core + pharmacy alone also works; re-running changes
     nothing.
     3. Windows: on a clean Windows 11 VM, one double-click installs the full
     suite, and separately one module alone, then opens the setup wizard; silent
     install works the same.
     4. macOS: on a clean Apple Silicon and an Intel Mac, the notarized pkg
     installs the full suite and a single module with no Gatekeeper warning;



                                                                                  Page 6 of 7
CLNIQ Build and Packaging Prompt




     Homebrew install works.
     5. Upgrade N-1 to N on all three targets keeps all data, with a synthetic
     user clicking through the app the whole time and seeing no errors; a forced
     failure rolls back automatically.
     6. A prerequisite update (runtime patch, Postgres minor) applies on schedule
     on Windows and macOS with no data loss and no user-facing error.
     7. Images and installers are signed, have SBOMs and pass the scan gate;
     Renovate PRs and the weekly rebuild run.
     8. README covers install, upgrade, backup, restore and uninstall for each
     target and for single-module installs.


     # Working style
     Small, reviewable PRs, one milestone each: (1) design capture, tokens and UI
     library, (2) container images and native bundles, (3) Azure Web Apps one-
     click, (4) Windows installer, (5) macOS installer, (6) updater and zero-
     downtime release pipeline, (7) hardening and docs. After each, report what
     you built, the evidence for its checks, and open questions. If anything here
     conflicts with the repo, the blueprint or clniq.com, stop and ask rather than
     guess.




                                                                                 Page 7 of 7
