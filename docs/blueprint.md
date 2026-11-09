# CLNIQ Modular Multi-Tenant Deployment Blueprint

Nov 8, 2026 · @Sooraj Sudevan

Ship CLNIQ as one modular monolith with hard module boundaries, a shared control plane for tenants, entitlements and RBAC, and per-tenant data isolation — then peel modules into services only where scale demands it.

## 1. clniq.com vs the feature map

clniq.com today is the clinical core (modules 1, 2, 4); the diagram adds a full revenue stack (3, 5, 6, 7, 8) that does not exist yet. The live site is a client-rendered app, so only its public positioning was readable: digital prescriptions, token and queue management, and instant patient records ([clniq.com](https://clniq.com)).

| # | Diagram module | On clniq.com today | Gap to close |
| --- | --- | --- | --- |
| 1 | Patient Management | Patient records, registration, booking | Merge walk-ins and bookings into one patient master per tenant |
| 2 | Visit & Consultation | Token / queue flow, check-in | Visit types (new / follow-up / emergency) as first-class records |
| 4 | Doctor Consultation / Rx | Digital prescriptions | Structured Rx lines (drug master codes) so pharmacy can consume them |
| 3 | Clinic Billing | Not visible | New module: tariffs, packages, discounts with approval, GST, receipts |
| 5 | Pharmacy Billing | Not present | New module, depends on 4 and 6 |
| 6 | Inventory & Stock | Not present | New module: batch, expiry, inward, adjustments |
| 7 | Payments & Financial Control | Razorpay for CLNIQ subscriptions only | Clinic-side ledger: split, advance, refund, dues, reconciliation |
| 8 | Reports & Analytics | Not visible | Read-model over all modules' events |
| Core | Multi-tenant, RBAC, audit, masters, numbering | Implicit (per-doctor accounts) | Explicit control plane — the main build in this plan |

Key implication: CLNIQ owns both billing layers — its own subscription billing to clinics (control plane, Razorpay for collection) and each clinic's billing to patients (modules 3 and 7). Keep them in separate ledgers so clinic revenue never mixes with CLNIQ's.

## 2. Target architecture

&#91;embedded content: CLNIQ target architecture · 3 planes, 2 gates\]

The control plane decides what a tenant may use; each module decides what a user may do; the database enforces which tenant, clinic and doctor a row belongs to.

## 3. Tenancy model

Four scopes, each a hard filter: Platform → Tenant (the paying organisation) → Clinic (a branch) → Practice (one doctor's private workspace). Every row in every module carries `tenant_id`, `clinic_id` and, for clinical data, `practice_id`.

| Scope | Who | Isolation mechanism | Shared across it |
| --- | --- | --- | --- |
| Platform | CLNIQ ops | Separate control-plane DB and admin app; no patient data | Module catalogue, plans, global drug master |
| Tenant | Clinic owner / hospital group | PostgreSQL Row-Level Security on `tenant_id`, per-tenant encryption key (envelope via Key Vault); Enterprise tier can get a dedicated schema or DB | Tenant masters, tariffs, users, numbering series |
| Clinic | Branch | `clinic_id` in RLS policy + token claim; queues, counters, stock locations per clinic | Patient master (tenant-wide UHID) |
| Practice | One doctor | `practice_id` in RLS for clinical tables (notes, Rx, diagnosis); revenue tagged per doctor | Nothing clinical by default; sharing is explicit (referral or consent grant) |

Rules that keep doctors isolated inside one tenant:

- Clinical tables enforce `practice_id = current_setting('app.practice_ids')`; reception sees demographics and queue, never notes.
- A patient can exist once per tenant (one UHID) but each doctor sees only visits in their own practice, unless the patient record is shared through a logged consent or referral.
- Billing and reports aggregate across practices only for roles holding the `finance:read:tenant` permission (owner, accountant).
- Solo doctor on the ₹1,499 plan = a tenant with one clinic and one practice; the same code path scales to a 40-doctor polyclinic.

DB session context is set per request from the verified JWT, never from request parameters, so a bug in a handler cannot widen scope.

## 4. Two-layer RBAC

Access is granted only when both layers say yes: the tenant is entitled to the module (commercial layer) AND the user's role permits the action in that scope (tenant layer).

```latex
\text{allow} = \text{entitled}(tenant, module, feature) \land \text{permitted}(user, action, scope) \land \text{within\_limits}(tenant, metric)
```

**Layer A — Commercial entitlements (platform plane).** Owned by CLNIQ; driven by CLNIQ's own Subscription Service.

- Catalogue: module (e.g. `pharmacy`), feature flags inside it (e.g. `pharmacy.walk_in_sale`), and metered limits (doctors, clinics, Rx per month).
- Plan = bundle of entitlements: Solo (1, 2, 4), Clinic (+3, 7, 8), Clinic+Pharmacy (+5, 6), Enterprise (all + multi-branch + dedicated DB).
- Subscription Service (plans, add-ons, GST invoices, Razorpay Subscriptions for recurring collection) → on payment or plan change, Entitlement Service writes a signed entitlement snapshot per tenant; cached in Redis, version stamped into the JWT (`ent_v`).
- States: `active`, `grace` (read + bill, no new modules), `suspended` (read-only export), `terminated` (data retained per policy, then purged).
- Platform roles: Platform Admin, Commercial Manager (plans, add-ons), Support (time-boxed, tenant-approved break-glass, fully audited).

**Layer B — In-tenant roles (tenant plane).** Owned by the tenant's admin; permissions are `module:action:scope`.

| Role | Typical permissions | Default scope |
| --- | --- | --- |
| Admin / Clinic Owner | users, masters, tariffs, discounts approve, all reports | Tenant |
| Reception | patient create/edit, visit create, queue, clinic billing create, payment collect | Clinic |
| Doctor | own queue, history view, notes, Rx, service recommendation | Practice |
| Pharmacist | Rx view (dispense fields only), pharmacy bill, stock movement | Clinic |
| Accountant | payments, refunds approve, dues, reconciliation, finance reports | Tenant |

- Roles are templates; tenants clone and trim them but can never grant a permission whose module they are not entitled to (the UI hides it, the API rejects it).
- One user can hold different roles per clinic (a doctor who is also owner of branch A).
- Enforcement: API gateway checks entitlement; each module checks permission via a shared policy library (OPA/Cedar-style rules or Casbin) reading the JWT claims; RLS enforces scope in the database as the last line.

## 5. Module contract: standalone and API-pluggable

Every module, and the core itself, is a product in its own right: it runs alone with its own UI, plugs into the other CLNIQ modules through the same public APIs and events any partner uses, and can be plugged into a third-party system instead. Nothing has a private back door into another module.

1. **Own data.** One Postgres schema per module (`patient`, `visit`, `rx`, `billing`, `pharmacy`, `inventory`, `payments`, `reporting`). Cross-module references are IDs only; no module reads another's tables.
2. **Own deployable.** Each module is its own container image with its own migrations, health checks and scaling rules. Default packaging runs them together; any one can run alone or on its own cluster without code changes.
3. **API-first, one API for everyone.** REST/OpenAPI `/api/v1/{module}/…` is the only way in, for CLNIQ's own UI, other modules and partners alike. Versioned with expand–contract; idempotency keys on every write; cursor pagination; generated SDKs (TypeScript, Python, Java).
4. **Events and webhooks.** Domain events go out through a transactional outbox (`PatientRegistered`, `VisitCreated`, `CaseSheetSigned`, `PrescriptionIssued`, `InvoiceRaised`, `PaymentCaptured`, `StockMoved`, `ItemNearExpiry`). Partners subscribe through signed, retried webhooks. Every event carries `tenant_id`, `clinic_id`, `practice_id`, `actor`, `correlation_id`.
5. **Ports, not dependencies.** Where a module needs another capability, it calls a port with three adapters: the CLNIQ module, an external system (FHIR R4 or the partner's API), or manual entry. Example: Pharmacy's prescription port reads CLNIQ Rx, a hospital HIS's FHIR MedicationRequest, or a typed-in paper Rx.
6. **External IDs.** Every resource stores `external_ref` per source system, so a module can sit beside a clinic's existing EMR or HIS without duplicate patients or bills.
7. **Headless or with UI.** Each module ships its UI as a lazy-loaded micro-frontend that can also be embedded (iframe or web component) in a partner's app with the same tenant and role scope.
8. **Entitled per channel.** Entitlements cover both how a tenant uses a module (CLNIQ UI, API, or both) and its API quota, so "Pharmacy via API only" is a sellable plan.

**Each module: alone, with CLNIQ, or with someone else's system**

| Module | Runs alone as | Plugs into CLNIQ via | Plugs into external systems via |
| --- | --- | --- | --- |
| Core platform | Identity, tenancy, roles, entitlements, audit, numbering for any app | OIDC tokens, policy library, entitlement API | OIDC/SAML federation, SCIM user provisioning, audit export |
| 1 Patient | Patient master and UHID registry | `PatientRegistered`, patient API | FHIR Patient, ABHA linking, CSV import |
| 2 Visit | Token and queue system | `VisitCreated`, queue API | FHIR Appointment/Encounter, display-board API |
| 3 Clinic billing | Standalone clinic billing | `InvoiceRaised`, consumes visits and Rx | Billing API for any HIS; Tally export |
| 4 Case sheet / Rx | EMR for a solo doctor | `CaseSheetSigned`, `PrescriptionIssued` | FHIR Composition, MedicationRequest; ABDM HIP |
| 5 Pharmacy | Walk-in pharmacy POS | Consumes Rx, emits sales | Prescription port accepts FHIR or partner Rx |
| 6 Inventory | Stock and expiry control | `StockMoved`, stock API | Supplier and distributor APIs, barcode import |
| 7 Payments | Collections and reconciliation | `PaymentCaptured` | Razorpay and other gateways via adapters, bank statement import |
| 8 Reports | Analytics on its own data store | Subscribes to all events | Read API, scheduled exports, BI connector |

**The core as a product.** Identity, tenancy, RBAC, entitlements, audit and numbering are served as APIs, not a shared library alone. A partner app can use CLNIQ's core for login and roles without any clinical module, and a CLNIQ module can be deployed for a partner with only the core.

**Partner access.** Partners register in a developer portal and get OAuth2 client credentials scoped to one tenant and to the modules that tenant is entitled to, with per-tenant rate limits. The tenant owner approves each integration and can revoke it; every partner call is in the audit log. A sandbox tenant with synthetic data supports integration testing.

**How the contract is enforced.** Contract tests between every module pair, a CI rule that blocks cross-schema queries, and a quarterly "run alone" test that boots each module with only the core and the manual adapters.

Start as a modular monolith for operations, not for coupling: the same images, run together. Split a module onto its own service when its scale, release cadence or a partner deployment calls for it — Pharmacy and Reports are the likely first two.

## 6. Customer lifecycle

A Lifecycle Service in the control plane drives every tenant and every doctor through explicit states; each transition is an event, is audited, and changes entitlements automatically. No step depends on a manual login hand-off.

**Tenant lifecycle**

| Stage | Trigger | What the platform does | Data state |
| --- | --- | --- | --- |
| 1. Sign-up / trial | Owner signs up (phone + email OTP), picks a plan | Creates tenant in `trial`; time-boxed trial entitlements | Live, trial-limited |
| 2. Verification | Documents uploaded | Practitioner verification (registration number against the medical council, certificate/ID, manual exception review, 24–48 h SLA); clinic GSTIN and drug licence if pharmacy is bought | Clinical write blocked until approved |
| 3. Provisioning | Verification approved + Razorpay payment confirmed | Tenant key in Key Vault, default clinic, one practice per doctor, role templates, numbering series, subdomain, entitlement snapshot, owner invite | Live |
| 4. Setup wizard | Owner first login | Tariffs and services, drug master import, Rx letterhead and signature, working hours, queue rules, staff invites | Live |
| 5. Data import and go-live | Owner uploads files | Patient CSV/Excel import with UHID mapping and dedupe, opening stock; go-live checklist; onboarding health score | Live |
| 6. Active / change | Plan upgrade, add-on, new branch or doctor | Prorated invoice, entitlement re-issued, new practice or clinic provisioned | Live |
| 7. Grace | Renewal payment fails | Reminders; no new modules or seats; clinical work continues | Live |
| 8. Suspended | Grace expires | Read-only plus self-service export; billing and new visits blocked | Read-only |
| 9. Offboarding | Owner cancels or suspension ends | Full export package (patients, visits, case sheets and Rx as PDF and FHIR JSON, invoices, audit log), signed and delivered; users deprovisioned | Retention hold |
| 10. Terminated | Clinic confirms receipt of its full record copy, and the agreed hold ends | Crypto-shred (tenant key destroyed), DB rows and blobs purged, deletion certificate issued | Gone |

**Doctor lifecycle inside a tenant**

- **Join:** owner invites → doctor verifies (or reuses an existing CLNIQ verification) → practice created → seat counted against the plan, prorated.
- **Reverify:** registration validity checked on a schedule; an expired registration blocks signing Rx and case sheets until renewed.
- **Move or share:** a doctor can hold practices in several tenants, each isolated; one login, a tenant switcher.
- **Leave:** user disabled and sessions revoked immediately; practice frozen read-only; open follow-ups reassigned by the owner; records stay with the tenant as custodian; seat released at the next billing cycle.

Patients can also request access to or correction of their data under DPDP; that flows through the tenant, since the clinic is the data fiduciary and CLNIQ the processor.

## 7. AI-enhanced case sheets

Module 4 becomes a structured case sheet in which AI only suggests. AI has no write, send, order, schedule or bill rights anywhere in the platform; every AI output is a proposal that changes nothing until a named human accepts it. AI is a metered add-on entitlement per doctor (`consult.ai_casesheet`).

**Case sheet structure** (each a coded, separately editable field): chief complaint, history of present illness, past/family/social history, allergies, current medication, vitals, examination, provisional diagnosis (SNOMED CT, mapped to ICD-10 for reporting), investigations (LOINC), plan, Rx, advice, follow-up.

**AI across the consult**

1. **Pre-visit intake.** Patient answers a fixed symptom questionnaire by WhatsApp link or reception tablet. AI proposes a chief complaint and history for the doctor; it never replies to the patient with advice, triage or reassurance.
2. **Patient snapshot.** On opening the visit, AI proposes a summary of this practice's prior visits: chronic conditions, last labs, current meds, missed follow-ups. Retrieval is scoped to the doctor's own practice before the prompt is built.
3. **Dictated or ambient scribe.** Only after the patient gives a separate, recorded consent for recording. Speech-to-text handles Indian English and code-mixed Malayalam/Hindi; AI proposes values for each case sheet field. Audio is deleted once the doctor signs.
4. **Decision support.** AI proposes red flags, differentials, SNOMED CT / ICD-10 codes and investigations, each with its reasoning. Nothing is ordered; the doctor adds what they choose.
5. **Rx suggestions.** AI proposes structured lines from dictation, generic name first. Allergy, drug–drug and dose-range checks are deterministic rules that warn the doctor. Only the doctor creates the Rx.
6. **Sign.** The doctor reviews each proposed field (accept, edit or reject) and signs with their digital signature. A signed case sheet is immutable; a later correction creates a new version and the old one stays in the audit trail. Signing is the only action that writes the case sheet and emits `CaseSheetSigned` and `PrescriptionIssued`.
7. **After the visit.** AI proposes a patient-language summary and dosing instructions (English plus major Indian languages, starting with Malayalam, Hindi, Tamil, Kannada and Telugu) and a follow-up interval. The doctor approves and presses Send; reception books the follow-up.

**Architecture and guardrails**

| Concern | Design |
| --- | --- |
| Suggest-only by construction | The Clinical AI service holds a read-only, practice-scoped token. Its output lands in a separate `ai_suggestion` table (proposed / accepted / edited / rejected), never in the clinical record; only a human action copies it across |
| No self-actioning | AI cannot emit domain events, call other modules, send messages, create orders, book slots or raise bills. Enforced in the policy layer, not just the UI |
| Explicit acceptance | Each clinical field is accepted on its own; no silent defaults. Proposed text is visually marked as AI until accepted |
| Patient-facing AI | None. Any text reaching a patient is approved and sent by the doctor or staff |
| Where AI runs | LLM and speech models hosted in India, zero data retention, no training on tenant data; listed as sub-processors |
| Isolation | Context built only from the calling doctor's practice and the current patient; tenant and practice IDs checked before retrieval |
| Audit | Each suggestion logged with model version, prompt version, the human decision and who made it |
| Quality | Golden set of de-identified case sheets per specialty; acceptance and edit-rate tracked per field; regression run before each model or prompt change |
| Failure mode | AI unavailable → the plain structured case sheet works unchanged |
| Commercials | Entitlement plus metering (AI case sheets or scribe minutes per doctor per month) through the Subscription Service |

This matches the Telemedicine Practice Guidelines, under which AI may assist but cannot counsel patients or prescribe, and ICMR's 2023 AI ethics principle of human oversight. Decision support can still count as medical device software under CDSCO rules, so section 8 gates it.

## 8. Compliance guardrails (India)

Design to the DPDP Act 2023 and DPDP Rules 2025 now, even though their core duties start on 13 May 2027. The Rules were notified on 13 November 2025, consent-manager provisions start on 13 November 2026, and until May 2027 IT Act section 43A and the 2011 SPDI Rules still apply ([Legal 500](https://www.legal500.com/intelligence/india/privacy/digital-personal-data-protection-rules-2025-highlights)). Medical-record duties from the medical code apply today.

**Roles.** Each clinic tenant is the data fiduciary for its patients. CLNIQ is its data processor, under a signed data processing agreement with every tenant. CLNIQ is a fiduciary only for its own customer data: owner and doctor accounts, and subscription billing.

| Requirement | Source | How CLNIQ implements it |
| --- | --- | --- |
| Standalone plain-language notice listing data, purposes and services; withdrawal as easy as consent | DPDP Act, Rules 2025 | Per-tenant notice templates in English, Malayalam and Hindi shown at registration; consent ledger per patient per purpose (treatment, reminders, AI recording, ABDM sharing); one-tap withdrawal |
| Children under 18: verifiable parental consent; exemption for clinical establishments and healthcare professionals limited to providing health services to the child | DPDP Rules, Schedule IV ([text](https://dpdpa.com/schedule/schedule4.html)) | Guardian captured and verified at minor registration; treatment runs under the exemption; reminders, marketing and AI recording need the guardian's consent |
| Security: encryption, masking, access control, monitoring; breach-detection logs kept at least 1 year | DPDP Rules 2025 | RLS, per-tenant keys, field masking for staff roles, immutable audit; logs retained ≥ 1 year (longer where another law says) |
| Breach: inform the Board without undue delay, detailed report within 72 h; inform affected people without delay | DPDP Rules 2025 | Incident runbook; CLNIQ alerts the tenant at once with scope per tenant from the logs; pre-drafted notices the clinic approves and sends |
| Grievances resolved within 90 days; published way to exercise rights; nominees | DPDP Rules 2025 | Rights-request workflow in tenant admin (access, correction, erasure, nominee), with SLA timers and evidence |
| Hospitals may be designated Significant Data Fiduciaries: DPO in India, annual DPIA and audit, data kept in India | DPDP Act, Rules ([Mondaq](https://www.mondaq.com/india/healthcare/1722484/health-data-the-dpdp-actnavigating-indias-healthcare-privacy-frontier)) | Enterprise tier ships DPIA inputs and audit exports; all data already stays in Indian regions |
| Research and statistics only on data meeting the Second Schedule standards, never used for decisions on an individual | DPDP Rules | Platform analytics and AI evaluation sets use de-identified data only |
| Medical records kept 3 years (indoor patients) from start of treatment; copies issued within 72 h of a request | Code of Medical Ethics Regulations 2002, 1.3 ([NMC](https://www.delhimedicalcouncil.org/pdf/EthicsRegulations-2002.pdf)) | "Issue records" action producing a signed PDF bundle, with a 72 h timer; retention policy per tenant with 3 years as the floor |
| Registration number on every prescription, certificate and receipt; generic names, legible | Code 2002, 1.4 and 1.5 | Rx, certificate and receipt templates block printing without the doctor's registration number; generic name is the primary Rx field |
| Confidentiality; disclosure only by court order, identified risk, or notifiable disease | Code 2002, 2.2 and 7.14 | Disclosure is a logged, reason-coded action by the doctor or owner; no bulk export without owner approval |
| AI may assist but cannot counsel or prescribe; patient consent recorded; age asked; minors only with an identified adult; doctor's registration shown | Telemedicine Practice Guidelines 2020 ([Medianama](https://www.medianama.com/2020/03/223-summary-india-telemedicine-guidelines/)) | Suggest-only AI (section 7); teleconsult consent and age captured on the visit; guardian present flag for minors |
| ABHA voluntary; share only against a valid consent artefact; care context per visit; FHIR R4, fully structured within a year of certification | ABDM HIP guidelines ([summary](https://productgrowth.in/insights/healthtech/abdm-hip-hiu-roles-consent-flow/)) | ABHA optional at registration; care context created on signing; consent-checked HIP service; case sheet already structured |
| Clinical decision support and AI diagnostics can be medical device software under MDR 2017 | CDSCO guidance ([summary](https://www.mavenrs.com/blog/cdsco-medical-device-software-guidance-ai-mdr-2017)) | Drop (a) of the AI case sheet is documentation assistance only; differentials and red flags (drop b) ship only after a regulatory classification opinion |
| Human oversight, accountability, audits for AI in healthcare | ICMR AI ethics guidelines 2023 ([Down To Earth](https://www.downtoearth.org.in/health/icmr-releases-guidelines-for-artificial-intelligence-use-in-the-health-sector-88338)) | Per-suggestion audit trail and periodic quality review, published to tenants |

**Where erasure meets retention.** A patient's erasure request removes reminders, marketing and AI artefacts at once. Signed clinical records are never deleted on a patient's request: they stay frozen and access-restricted, since the EHR Standards expect lifetime preservation. The reason is recorded and told to the patient.

This is an engineering reading of the sources, not legal advice; confirm the retention period for outpatient records and the CDSCO position with counsel.

## 9. Benchmark against Indian EMRs

CLNIQ matches the clinic EMRs on core consult and billing, and leads on tenant isolation and AI governance. It lags on four things the market already treats as standard: clinical coding, ABDM certification depth, a lab module, and Indian-language reach. Competitor features below are as published by the vendor or its listings, not tested.

| Capability | HealthPlix | Eka Care | Practo Ray | MocDoc / KareXpert (hospital HMIS) | CLNIQ blueprint | Position |
| --- | --- | --- | --- | --- | --- | --- |
| Primary market | 14,000+ doctors, AI EMR ([overview](https://www.healthplix.com/overview-healthplix)) | Doctors + patient health records | Clinics, multi-branch ([listing](https://www.techjockey.com/detail/practo-ray)) | Hospitals, groups, labs, pharmacy chains ([comparison](https://mocdoc.com/blog/mocdoc-vs-karexpert-hospital-management-software-comparison)) | Solo doctor to polyclinic | Clinic segment, like HealthPlix and Ray |
| Rx languages | 14 regional languages | Hindi-English code-mixed | Not stated | Not stated | English, Malayalam, Hindi | Lags |
| AI scribe | H.A.L.O ambient, English and Hindi ([report](https://www.digitalhealthnews.com/healthplix-launches-ai-powered-h-a-l-o-for-doctor-patient-interactions)) | EkaScribe on its own India-hosted LLM, SOAP or Rx output, doctor review ([report](https://www.digitalhealthnews.com/eka-care-launches-india-s-first-ai-medical-scribe-powered-by-its-own-purpose-built-llm-parrotlet-)) | Not stated | MocDoc SenZ scribe listed | Suggest-only scribe, per-field acceptance, no AI actions | Parity on capability; leads on governance |
| Decision support | Assistive CDSS at point of care | Not stated | Not stated | "AI-ready analytics" | Gated behind CDSCO opinion (drop b) | Lags on timing, by design |
| Billing and payments | Not stated | Not stated | Billing + online payments | Multi-payer, insurance in IP billing, e-claims | Clinic billing, split/advance/refund, day-close | Parity for clinics; no insurance/TPA |
| Pharmacy and inventory | Not stated | Not stated | Not stated | Integrated, inter-branch stock transfers | Phase 3, batch/expiry/FEFO | Parity; add stock transfer |
| Lab | Not stated | Not stated | Not stated | LIMS, machine integration, RIS/PACS | None | Lags |
| ABDM | ABHA product | Consent capture per ABDM | Not stated | KareXpert certified; MocDoc M1–M3 | Phase 4 | Lags — bring forward |
| Patient engagement | Patient app | Patient PHR app | SMS/email reminders, Practo.com listing | WhatsApp, portal, telemedicine | WhatsApp summaries, Google Meet booking | Partial |
| Pricing | Not stated | Not stated | From ₹1,499, excl. GST | Not stated | ₹1,499/doctor/month incl. GST, annual | Same headline price as Ray |
| Tenancy, per-doctor isolation, module entitlements | Not published | Not published | Not published | Not published | Explicit design (sections 3–4) | Lead, if marketed |

**What the standards add.** The MoHFW EHR Standards make SNOMED CT the clinical terminology, LOINC the lab coding and ICD-10 the reporting classification. They also require saved records to be immutable, with corrections as new versions, digitally signed e-prescriptions, and preservation for the patient's lifetime ([NRCeS](https://www.nrces.in/standards/ehr-standards-for-india)). NABH now certifies HIS/EMR products, for 2 years, but only those with ABDM M3 and at least 3 live hospital deployments ([NABH](https://nabh.co/programmes/digital-health-standards-his-emr-systems/)).

**Changes made to this blueprint as a result**

1. Case sheet coding is now SNOMED CT for clinical terms, LOINC for investigations and ICD-10 for reporting (section 7).
2. A signed case sheet is immutable: corrections create a new version with an audit trail, and signing uses the doctor's digital signature (section 7).
3. Offboarding never destroys records without first handing a complete copy to the clinic as custodian; patient erasure never deletes signed clinical records (sections 6 and 8).
4. ABDM moves earlier: ABHA capture (M1) in Phase 1, record sharing as HIP (M2) in Phase 2, HIU (M3) in Phase 4, then NABH EMR certification (section 10).
5. Phase 4 adds a lab-orders module (external lab integration, LOINC results), inter-branch stock transfer and insurance/corporate billing.
6. Rx and patient instructions target the major Indian languages, not three.

Positioning: with the same headline price as Practo Ray and comparable AI to HealthPlix and Eka, CLNIQ's defensible story is the integrated clinic revenue stack plus provable isolation and suggest-only AI.

## 10. Phase-by-phase plan

Six phases, about 30 weeks for a small team (indicative). Phase 0 is added ahead of the diagram's four, because tenancy, entitlements and RBAC cannot be retrofitted cheaply. Each phase ships to production behind entitlement flags.

**Phase 0 — Platform foundation (weeks 1–6)**

- Control plane: Tenant, Clinic, Practice, User registry; Entitlement Service; Subscription Service (plans, annual billing, GST invoices, Razorpay Subscriptions and webhooks).
- Identity: Entra External ID or Keycloak (OIDC), MFA for owners/doctors, JWT claims `tid`, `cids`, `pids`, `roles`, `ent_v`.
- Shared kernel: policy library, audit writer (append-only, hash-chained), numbering service (per tenant/clinic series for UHID, bill, Rx), tenant settings, master-data APIs.
- Platform: IaC (Terraform/Bicep), CI/CD, Postgres with RLS, Redis, event outbox + Service Bus, observability.
- Lifecycle Service: tenant and doctor state machines (section 6), sign-up with OTP, verification queue, automated provisioning on payment, grace and suspension handling.
- Compliance baseline (section 8): tenant data processing agreement, consent ledger and notice templates, rights-request workflow, breach runbook, log retention of at least 1 year, AI suggest-only policy enforced in the policy layer.
- API platform (section 5): public API gateway, OpenAPI specs and generated SDKs, webhooks with signing and retries, developer portal with OAuth2 client credentials, per-tenant API entitlements and rate limits, sandbox tenant, CI rule blocking cross-schema queries.
- Design system and packaging (sections 12–13): clniq.com style capture, token package and UI library with visual-regression gate; container and native builds; Azure, Windows and macOS one-click installers; signed updater and ring-based release pipeline.
- **Exit gate:** the core boots and serves login, roles and entitlements to a sample partner app with no clinical module; automated test proves tenant A cannot read tenant B and doctor X cannot read doctor Y's notes, at API and SQL level.

**Phase 1 — Patient + Visit + Clinic Billing (weeks 7–12)**

- Migrate existing CLNIQ patients, bookings and queue into modules 1 and 2 under the new tenant model (one tenant per current doctor account).
- Build module 3: tariffs, packages, discount with approval workflow, GST, invoice, receipt; minimal module 7 (cash/UPI/card capture, partial payment).
- Customer onboarding end to end: setup wizard, patient and stock import, go-live checklist, doctor join/leave; self-service export and the offboarding package with crypto-shred.
- ABDM M1: optional ABHA capture, verification and linking at registration.
- **Exit gate:** a reception user runs registration → token → bill → receipt end to end; existing doctors see no regression; a test tenant goes sign-up → live → offboarded → purged with no manual step.

**Phase 2 — Doctor notes + Prescription (weeks 13–16)**

- Re-platform today's digital Rx into module 4 with structured lines (drug code, dose, frequency, duration) and `PrescriptionIssued` events.
- Practice-level isolation switched on for clinical tables; Google Calendar/Meet booking stays a downstream integration.
- Structured case sheet first, then AI in two drops: (a) intake summary, patient snapshot and dictation-to-case-sheet; (b) decision support, ICD-10 coding and patient-language summaries. Deterministic Rx safety checks ship with (a).
- ABDM M2: CLNIQ acts as HIP — a care context per signed visit, consent-checked sharing of FHIR R4 records. SNOMED CT, LOINC and ICD-10 coding in the case sheet.
- **Exit gate:** multi-doctor pilot clinic (3+ doctors) passes isolation and audit review; doctors accept AI case sheet drafts with light edits on most visits, measured per field.

**Phase 3 — Pharmacy + Inventory (weeks 17–22)**

- Module 6: medicine master, batch/expiry, inward, adjustment, low-stock and near-expiry alerts.
- Module 5: Rx-linked billing, walk-in sale, FEFO dispensing, returns; both runnable standalone for pharmacy-only tenants.
- **Exit gate:** stock reconciles to zero variance across a 2-week pilot; pharmacy-only tenant onboarded without clinical modules.

**Phase 4 — Finance, integrations, multi-branch (weeks 23–30)**

- Full module 7: split/advance payments, refunds with approval, dues, day-close and reconciliation; revenue segregation by clinic and doctor.
- Module 8 on a read model (CDC or event projections) with Excel/PDF export; tenant-level dashboards.
- Multi-branch: shared patient master across clinics, branch-scoped roles, consolidated reporting.
- Integrations: ABDM M3 (HIU) and then the NABH HIS/EMR certification application, Tally export for clinic accounts, WhatsApp/SMS notifications.
- Gap closers from the benchmark (section 9): lab-orders module with external lab integration and LOINC results, inter-branch stock transfer, insurance and corporate billing.
- **Exit gate:** month-end close for a multi-branch tenant reconciles cash, gateway and invoices.

**Phase 5 — Scale and harden (ongoing)**

- Extract Pharmacy and Reports to separate services if load warrants; dedicated DB tier for enterprise tenants.
- DR drills, pen test, DPDP compliance review, cost per tenant tracking.

## 11. Hosting, CI/CD and operations

Host in Azure Central India with South India as DR, matching where CLNIQ components already run and keeping patient data in India.

| Layer | Choice | Why |
| --- | --- | --- |
| Edge | Azure Front Door + WAF, tenant subdomains (`{tenant}.clniq.com`) or custom domains | TLS, bot/OWASP rules, tenant routing |
| Web | SPA shell + lazy module bundles on Static Web Apps / CDN | Only entitled modules load |
| Compute | Azure App Service Web Apps for Containers (Linux): one Web App per module and the core, each with a staging slot | Per-module deploy and autoscale; slot swap gives zero-downtime releases |
| Data | Azure Database for PostgreSQL Flexible (zone-redundant), RLS, schema per module | Strong isolation, one cluster to run |
| Cache / bus | Azure Cache for Redis; Service Bus topics fed by outbox | Entitlement cache, async integration |
| Files | Blob Storage, path `tenant/clinic/practice/…`, SAS per request | Rx PDFs, reports, documents |
| Secrets | Key Vault, per-tenant data keys (envelope encryption) | Crypto-shred on tenant exit |
| Observability | OpenTelemetry → Azure Monitor / Grafana, every span tagged with `tenant_id` | Per-tenant SLOs, noisy-neighbour detection |

- **CI/CD:** monorepo, one pipeline per module (path filters), contract tests between modules, RLS isolation tests as a blocking stage, blue/green or canary per module.
- **Release by entitlement:** new modules ship dark; turned on per tenant by the Commercial Manager after the Subscription Service confirms payment for the add-on.
- **Backup/DR:** PITR 35 days, geo-redundant backups, RPO 15 min / RTO 4 h target; per-tenant export (JSON + PDF) for portability.
- **Tenant lifecycle automation:** Razorpay payment confirmed → provision tenant, default roles, numbering series, owner invite — removing today's manual provisioning steps.

## 12. Design system: 1:1 with clniq.com

Every CLNIQ surface looks exactly like [clniq.com](https://clniq.com): the suite, each module run alone, admin and setup screens, installers where the OS allows, tray and menu-bar apps, emails, WhatsApp templates, and printed Rx, invoices and receipts. Where any other spec disagrees on looks, clniq.com wins.

**Known so far.** Brand teal `#0d9488` (the site's theme colour), the "CLNIQ." wordmark, and a deliberately lean, "tailored, austere" visual style with calm, plain copy. Everything else is captured, not guessed: the site renders client-side, so its CSS cannot be read statically.

| Step | What happens | Output |
| --- | --- | --- |
| Capture | Playwright records computed styles on clniq.com at 1440, 1024, 768 and 390 px: colours, fonts, type scale, spacing, radii, borders, shadows, icons, motion, breakpoints. Logo and brand assets are pulled from the site. | Reference screenshots and a raw style inventory |
| Encode | One `design-tokens` package is the only source of colours, type and spacing; a lint rule blocks hard-coded values. | CSS variables, a Tailwind preset, JSON for native shells |
| Build | One `ui` component library (shell, nav, forms, tables, queue board, case sheet, Rx and invoice print) styled only from tokens. | Storybook, shared by every module's micro-frontend |
| Enforce | Visual-regression tests compare the app against the clniq.com references at all four widths; a token diff flags drift. A module run alone must be pixel-identical to the same module in the suite. | Blocking CI stage |
| Track | Monthly re-capture; if clniq.com changed, a pull request updates the tokens. | Site and app stay in step |

**Allowed extensions.** WCAG 2.2 AA contrast and focus states; Malayalam, Hindi, Tamil, Kannada and Telugu in a font family matched to the site's, at the same scale; print styles for Rx and invoices. These add to the look; they never change it.

## 13. One-click install and zero-downtime updates

The whole suite, and every module on its own, installs with one click or trigger on Azure Web Apps, Windows and macOS. Each install fetches its own prerequisites and keeps itself and them patched without downtime. A module installed alone brings the core with it; modules added later join that core. The tenant's signed entitlement decides what runs.

One build produces two artefacts per module and for the core: a signed container image (Azure) and a self-contained native service bundle (Windows and macOS, no Docker on clinic machines). A single `versions.json` pins every runtime, PostgreSQL and proxy version for all targets.

| Target | One click | Prerequisites fetched | Zero-downtime update |
| --- | --- | --- | --- |
| Azure Web Apps | "Deploy to Azure" button, `azd up`, or a GitHub Actions run with a module picker | Front Door + WAF, PostgreSQL Flexible (zone-redundant), Redis, Service Bus, Key Vault, Storage, App Insights, managed identities | Deploy to staging slot → warm-up and health check → smoke tests → swap; swap back on failure |
| Windows 10 22H2+, 11, Server 2019+ | One signed bootstrapper, full suite or chosen modules; silent mode and winget for IT | Runtimes, PostgreSQL, reverse proxy with local certificate, Windows services, tray app; SHA-256 and signature checked | New version installed side by side, health-checked, proxy switched atomically, old version drained and kept for rollback |
| macOS 13+ (Apple Silicon and Intel) | One signed, notarized .pkg with module choice; Homebrew cask and MDM silent install | Same set as Windows, as launchd daemons, menu-bar app, certificate trusted with consent | Same side-by-side switch as Windows |

**Update cadence.** Critical security fixes within 72 hours; a monthly patch train for runtimes and dependencies; feature releases every 2–4 weeks; LTS runtimes only; current and previous release supported. Renovate raises dependency and base-image updates, and every image is rebuilt and rescanned weekly. Releases roll out by ring (internal, pilot clinics, 10%, all) with a kill switch and automatic halt on rising errors.

**What makes "no downtime" hold.** Database changes are expand–contract only, so each release runs on the previous and next schema. The local updater verifies a signed release manifest, respects the clinic's ring and maintenance window, and does not update during a live consultation queue unless the fix is critical.

**The one exception.** A PostgreSQL minor update on a single clinic machine needs a database restart. It runs in the clinic's maintenance window after a backup; the app queues and retries writes, so users see at most a brief pause, never an error.

The build steps are in the [CLNIQ Build and Packaging Prompt](https://claude.ai/artifact/6ADdmi63f3L2LwKr1RUwST).

## 14. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| RLS misconfiguration leaks data across tenants or doctors | Policies generated from one template, blocking isolation tests in CI, quarterly external pen test |
| Entitlements drift from subscription or payment state | Subscription Service is source of truth; nightly reconciliation against Razorpay settlements; `grace` state instead of hard cut-off |
| Pharmacy introduces regulatory load (Schedule H/H1 registers, drug licence per clinic) | Licence number as a clinic-level master; Schedule H1 register report in Phase 3 scope |
| Migration of existing doctors breaks their daily flow | Phase 1 migrates silently with feature parity first; new modules off by default |
| Over-splitting into microservices early | Modular monolith until a measured scale trigger |

Open questions:

- [ ] Tenant URL model: shared `app.clniq.com` with tenant picker, or `{tenant}.clniq.com`?
- [ ] Pricing for modules beyond the ₹1,499/doctor/month core — per doctor, per clinic, or per module add-on?
- [ ] Should a patient's record be visible to all doctors in a tenant by default, or only by consent (affects DPDP consent design)?
- [ ] ABDM integration in Phase 4 or earlier, given HIP/HIU registration lead time?
- [ ] Custody model when a clinic leaves (EHR Standards expect lifetime preservation), and whether AI decision support needs CDSCO medical-device clearance — confirm with legal.
- [ ] Identity provider: Entra External ID (Azure-native) or Keycloak (self-hosted, open source)?
