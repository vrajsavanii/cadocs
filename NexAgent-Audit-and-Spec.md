# NexAgent / CADocs — Code-Level Audit & Engineering Specification

**Date:** 24 October 2026
**Scope:** full source tree of this repository (`cadocs`), audited against the four-layer improvement plan.
**Method:** direct inspection of `proxy.ts`, `lib/auth.ts`, `lib/db.ts`, `lib/engagements-db.ts`, `lib/workflow.ts`, `lib/services.ts`, `lib/reminders.ts`, `lib/billing.ts`, `lib/whatsapp.ts`, `lib/onboarding.ts`, `lib/crypto.ts`, all 57 API routes, `package.json`, `vercel.json`, plus live HTTP checks against the production deployment.

> **The single most important finding:** the plan was written against the **stale v3.1 report**, but the codebase has moved well past it. Roughly half of the plan's Phase 1–3 content — the engagement engine, the stage-gated filing workflow, the three-reminder policy, auto-billing, and a real WhatsApp Cloud API send path — **already exists in code**. The audit below separates what is genuinely done, what is partially done, and what is actually missing, so no already-built work is proposed a second time.

---

## 1. The reported inconsistency is resolved: auth and roles ARE implemented

The v3.1 report's deferred-features table listed "Auth & roles" as deferred while also describing working auth. The code settles it: **auth is fully implemented.** The stale table was a leftover from an earlier release.

Evidence:

| Control | File | Verified behaviour |
|---|---|---|
| Every-request gate | [proxy.ts](proxy.ts) | Verifies HMAC session cookie, re-reads the user row from SQLite per request, redirects unauthenticated browsers to `/login`, returns 401 JSON for APIs, blocks cross-origin mutating requests, applies a 300 writes/minute per-user brake |
| Central policy | [lib/auth.ts](lib/auth.ts) | `canAccess(role, method, path)`; reads open to all signed-in roles; mutations tiered |
| Sessions | [lib/crypto.ts](lib/crypto.ts), [lib/auth.ts](lib/auth.ts) | scrypt-hashed passwords, HMAC-SHA256 httpOnly cookies (12 h, SameSite=Lax), per-user `token_version` revocation — logout/password change invalidates every outstanding cookie |
| Login hardening | [app/api/auth/login/route.ts](app/api/auth/login/route.ts) | 10 attempts per IP+username per 15 min |
| Guest reset | `git`-visible in production checks | unauthenticated `/invoices` etc. return 307; APIs return 401 (verified live on 24 Oct) |

**More than that**, the role model has already been extended past the plan's assumption of a three-role system: [lib/workflow.ts](lib/workflow.ts) defines role-stage ownership (`article: documents/preparation`, `manager: review/filing`, `partner: signoff`) with server-side gates, and [lib/onboarding.ts](lib/onboarding.ts) captures consent/communication preferences. The article role **can write** — to timesheets, documents, document-requests, messages and the workflow stage it owns — which is a deliberate least-privilege grant, not a leak ([lib/auth.ts](lib/auth.ts) `canAccess`).

**Conclusion for the plan:** P0's "resolve the authentication discrepancy" item is **closed**. What remains for P0/P4 is verification breadth (every route × every role), not implementation.

---

## 2. What the code already implements that the plan assumed was missing

### 2.1 The engagement / service engine (plan Phase 2) — largely BUILT

| Plan requirement | Status | Where |
|---|---|---|
| Client ↔ service configuration separate from identity | ✅ Built | [lib/engagements-db.ts](lib/engagements-db.ts) — `client_services` table with its own `service_id`, `service_code`, `frequency`, `fee`, `billing_cycle`, `owner`, `reviewer`, `status`, `start_date`, `next_cycle_on`; one client can hold many services |
| Service-driven (not linear) workflows | ✅ Built | [lib/services.ts](lib/services.ts) — `SERVICE_LINES`, `currentCycle`, `fyForDate`, `requestByDate`, `serviceCodeFromLabel`; monthly/quarterly/annual cadences per service |
| Work and document requirements generated per period | ✅ Built | `ensureCurrentCycles()` creates the current period per active service with its checklist; `next_cycle_on` gates the following one |
| Duplicate prevention on generation | ✅ Built | lookups by `(client_id, service_code)` and `(compliance_id)` before insert; idempotent re-runs |
| Versioned checklist templates | ◐ Partial | checklists derive from the service definition in `lib/services.ts` (firm-wide), not per-firm/per-client editable templates yet |
| FY vs AY modelling | ◐ Built for FY | `fyForDate`, `fy_end_month` on clients; assessment-year field for ITR exists in the period string; needs an audit pass against plan §6 |

### 2.2 The document → reminder policy (plan Phase 3, §4A) — largely BUILT, one policy gap

[lib/reminders.ts](lib/reminders.ts) implements exactly the four rules the plan asks for:

1. Every active service gets its current period with its own document checklist.
2. One initial request, then reminders at a fixed gap — **never more than three**. The cap is enforced twice ([lib/reminders.ts](lib/reminders.ts) `HARD_CAP = 3`; [lib/engagements-db.ts](lib/engagements-db.ts) `REMINDER_CAP = 3` with `clampCap` in the DB write path) and is deliberately **not configurable above 3** — a stronger guarantee than the plan's.
3. The moment nothing is pending, the packet clears and reminders stop (`refreshRequestStatus`).
4. Completed work becomes an invoice and the client is told — see §2.3.

Per-request state (not per-client): `document_requests` rows carry `reminder_number`, `next_reminder_at`, `status`, and the outbox message carries `reminder_number` and `automation_key`. Reminders run from a **database-backed sweep** (`GET /api/cron/automation`, elapsed-time cadence, self-healing), not from a browser being open — exactly the plan's durability requirement.

**Gap found:** after the third reminder the engine stops, but it does **not** create the staff escalation task / "awaiting staff follow-up" state the plan requires (plan §4A final bullet, and acceptance test row 5). Escalation exists in the unrelated filing-automation sense (`escalate_overdue` automation rule) but is not wired into the document-request exhaustion path.

### 2.3 Billing wired to the work (plan Phase 4 partial) — BUILT

[lib/billing.ts](lib/billing.ts) is new since the report and does what plan §4C describes, minus the invoice *delivery* tracking:

- `invoiceCycleFor()`: when a filing cycle reaches **done**, the engagement's fee becomes an invoice — **once, idempotently** (unique `compliance_id` index + explicit lookup both stop duplicates; pass-fail for acceptance tests 14/16).
- The client gets a WhatsApp invoice message in the same outbox (`deliverWhatsApp`), with opt-in enforced (`client.whatsapp_opt_in`).
- Settings: `auto_billing`, `invoice_due_days` (clamped 1–90), `gst_rate` (clamped 0–28).

### 2.4 A real WhatsApp Cloud API path (plan Phase 3) — BUILT for outbound, missing inbound/delivery

[lib/whatsapp.ts](lib/whatsapp.ts) is far past "deep links":

- One shared dual-provider path: **queue** (`wa.me` deep link + outbox row) by default, **cloud** when `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and a template name are configured and `WHATSAPP_AUTO_SEND=1`.
- Sends **only approved templates** over the Cloud API (graph `v26.0`, body-parameter components), matching Meta's template requirement outside the 24-hour window.
- Opt-in is enforced in the callers ([lib/reminders.ts](lib/reminders.ts), [lib/billing.ts](lib/billing.ts)), opt-out is possible per client (`whatsapp_opt_in`).
- Failure is honest: send failure sets the outbox row to `Failed` with the provider error; the code's own header states "a template send is accepted by the API, not proof of delivery (webhooks…)".

**Gaps found (all plan §4B requirements):** no inbound webhook route, no delivery-status webhook, no provider message-id stored for idempotency/retry, single shared template for all kinds, no retry/backoff, no cost tracking. Detailed in §5.

### 2.5 The stage-gated filing workflow (plan §5) — largely BUILT

[lib/workflow.ts](lib/workflow.ts) (421 lines) implements the plan's Stage 1–7 lifecycle as a state machine:

- `STAGE_ORDER`: documents → preparation → review → filing → signoff → done.
- **Role-stage segregation enforced server-side** (`ROLE_STAGES`: article prepares but cannot review; managers review/file but cannot sign off; partners sign off) — the plan's "a reviewer cannot approve a return they prepared" is structurally satisfied by role separation.
- Gates: "a dashboard button cannot skip the partner's audit or close a filing without an acknowledgement number."
- Every transition writes a `task_events` row (actor, timestamp, old→new state) and an `audit_log` entry — the plan's "all state transitions record actor/timestamp/old/new/reason".
- [app/api/workflow/route.ts](app/api/workflow/route.ts) and [app/api/workflow/[id]/route.ts](app/api/workflow/[id]/route.ts) are the policy-checked mutation surfaces.

**Remaining plan §5 items not yet in code:** rejected work must return to the *correct prior stage with mandatory review notes* (the stage machine supports rework, but "mandatory review notes" text is not verified as required); no workload balancing / assignment escalation; no per-role queue dashboards beyond the existing desk views.

### 2.6 Other plan items already built

- **Onboarding & consent** ([lib/onboarding.ts](lib/onboarding.ts), [lib/services.ts](lib/services.ts) consent checklist): entity details, PAN/GSTIN, contacts, WhatsApp opt-in captured at onboarding; `whatsapp_opt_in` default **1** on new clients ([lib/db.ts](lib/db.ts) line 69) — for a commercial product this default should be flipped to **opt-out** (0) so outreach is opt-in only.
- **Guided first-run setup**: the dashboard's 3-step setup card + onboarding module.
- **CSV export / data rights**: `GET /api/export?type=…` for every register.
- **AI copilot with proposal-gated writes, role-scoped tools, quota, audit** ([lib/ai-agent.ts](lib/ai-agent.ts), [lib/ai-tools.ts](lib/ai-tools.ts), [lib/ai.ts](lib/ai.ts)): the plan's "AI must not independently approve or file" is already the architecture (max 4 rounds / 8 calls, write = pending `ai_action`, approval re-validates).
- **Automation layer** ([lib/automation.ts](lib/automation.ts)): six rule types, auto/approval modes, dry-run previews, `automation_runs` + audit, natural-language planning validated before save; the sweep self-heals missed days.
- **Client folders**: `.data/uploads` with type/size allow-lists, metadata-backed virtual folders.

---

## 3. The real P0 blockers (verified, not assumed)

### 3.1 Persistence is the blocker the plan says it is

[lib/data-dir.ts](lib/data-dir.ts) routes all runtime state (SQLite file, 0600 keys, uploads) to `.data/` locally and **`/tmp/ca-suite` on Vercel**. `/tmp` is per-instance and ephemeral: cold starts lose client records, uploads, and queued messages; concurrent instances do not share state. Verified earlier on the live deployment (burst requests hit fresh instances). **This blocks real client data. No other work matters until it is fixed.**

### 3.2 Tenant isolation does not exist

Single-tenant by construction: every table is global, no `firm_id` column anywhere, no firm-scoped query layer. Selling to multiple firms (plan §8 Commercial) is impossible safely without it. This is the second P0.

### 3.3 No migrations tooling

[lib/db.ts](lib/db.ts) mixes `CREATE TABLE IF NOT EXISTS` with ad-hoc `addIfMissing`-style `ALTER` calls (line ~216) and data backfills in the boot path. There is no numbered migration ledger, no rollback, no migration test. Once two deployments exist (staging + prod), silent schema drift becomes a data-integrity risk.

### 3.4 No backups / restore process

No backup job, no PITR (SQLite file in `/tmp`), no restore runbook, no restore test.

### 3.5 No automated tests at all

`package.json` has no test script; no vitest/jest/playwright anywhere. The plan's 15 acceptance tests (§10) have zero automation today. Combined with no migrations, every schema change is currently verified only by hand.

### 3.6 Observability is zero

No structured logs, no error tracking, no job-health monitoring, no delivery metrics. Errors are deliberately swallowed to `null` in the AI layer (acceptable there) but the same pattern has no prod equivalent — a failing cron sweep today is silent.

---

## 4. Gap table — plan §7 mapped to the actual codebase (`vCurrent` = audited Oct 24)

| Capability | Plan's "reported current state" | **Audited actual state** | Required improvement (file-level) |
|---|---|---|---|
| Client profile | Implemented | Implemented + `whatsapp_opt_in`, `onboarding_status`, `relationship_manager`, `fy_end_month` | Multi-GSTIN per client (`client_gstins` table) — see §5.P1 |
| GST/TDS/ITR tracking | Implemented | Implemented + **stage machine** (`lib/workflow.ts`) with role gates + `ack_number` evidence + `task_events` history | Mandatory review notes on rejection; deadline-override recalculation of reminders |
| Staff assignment | Existing role controls | Role-stage ownership exists | Workload balancing + escalation util |
| Document requests | Implemented | Implemented + per-request `reminder_number`/`next_reminder_at`, status lifecycle, cap-3 enforced twice | Escalation task on exhaustion; **versioned per-firm checklist templates** |
| WhatsApp | Deep links and prepared outbox | **Real Cloud API template send exists** (queue/cloud dual path, opt-in, honest failures) | Inbound webhook, status webhook, provider message-id, multi-template map, retries, cost tracking |
| Invoices | GST creation + payments | Implemented + **auto-billing on cycle completion, idempotent**, WhatsApp invoice message | Invoice delivery tracking (webhook); dunning connecting to reminders |
| Client folders | Implemented | `.data/uploads`, type/size allow-lists, virtual metadata folders | Production object storage (private, time-limited links), versioning, checksums, retention |
| AI copilot | Implemented with approval-controlled writes | Implemented exactly so | Workflow-specific assists only — do not extend authority |
| Recurring automation | Six rule types + presets | Implemented + client-side reminder engine | Escalation queue, retry policy, run-monitoring/alerts |
| Reporting | Operational/financial reports | Ageing/realisation/utilisation/profitability/filing data present | Workflow bottleneck & SLA & reminder-performance reports |
| Authentication | "Conflicting claims" | **Fully implemented and verified** — stale table resolved | Verification matrix (every route × role) as tests, not more code |
| Persistence | Ephemeral `/tmp` | Confirmed blocker | Postgres (or durable volume) + object storage — §5.P0 |
| Government integrations | Explicitly deferred | Still deferred, correctly; `ack_number` + manual filing recorded honestly | Keep deferred until an authorised integration route is verified |

---

## 5. Engineering specification — file-by-file, in the plan's phase order

> Order preserved from the plan: persistence & tenancy before workflows; workflows before messaging; messaging polish last of the risky work. Items marked **★** are new findings not in the original plan.

### P0 — Production safety & architecture (the release blocker)

**Decision to make with the owner (one question):** Postgres vs durable SQLite.

- **Option A (recommended): managed Postgres** (Vercel Postgres / Neon / Supabase). Multi-tenant SaaS with concurrent writes needs transactional integrity and PITR; `node:sqlite` in `/tmp` is a demo substrate. Port the ~22-table schema and the SQL in [lib/db.ts](lib/db.ts)/[lib/engagements-db.ts](lib/engagements-db.ts). **Pragmatics:** the SQL layer is confined to two files + `lib/billing.ts`/`lib/workflow.ts` raw queries; before porting, hoist `db.prepare(...)` call sites into typed functions in `lib/db.ts` / `lib/engagements-db.ts` one module at a time so the provider swap is a driver change, not a rewrite. Local dev keeps SQLite for speed; CI runs against Postgres to catch dialect drift.
- **Option B (cheaper, still safe): keep SQLite but on a real disk** (single small VM / Fly.io volume / Railway), one writer, object storage elsewhere. Acceptable for a first paid cohort (10–20 firms on isolated DBs = poor-man's tenancy), not acceptable for a large SaaS.

Either way, in P0 do the following, in order:

| # | Change | Files |
|---|---|---|
| 0.1 | Hoist all inline SQL behind typed accessors so the engine is swappable; no `db.prepare()` outside `lib/db.ts`, `lib/engagements-db.ts` | [lib/db.ts](lib/db.ts), [lib/engagements-db.ts](lib/engagements-db.ts), [lib/billing.ts](lib/billing.ts), [lib/workflow.ts](lib/workflow.ts) |
| 0.2 | Numbered migration ledger + runner using `PRAGMA user_version` (SQLite) / `schema_migrations` (Postgres); move boot-time `ALTER`s and backfills into it; delete the ad-hoc adds | new `lib/migrations.ts`, `migrations/0001_init.sql`, [lib/db.ts](lib/db.ts) |
| 0.3 | `firm_id TEXT` on every business table + `firms` table; `firmContext()` resolved in [proxy.ts](proxy.ts) from the session (never from client input); every accessor gains `AND firm_id = ?`; seeded single-firm row so existing behaviour is unchanged for the pilot firm | [lib/db.ts](lib/db.ts), [lib/engagements-db.ts](lib/engagements-db.ts), [lib/auth.ts](lib/auth.ts), [proxy.ts](proxy.ts), all 57 route files touched only via accessors |
| 0.4 | Uploads to private object storage (R2/S3): `putObject/getObject/signedUrl`; uploads served only through time-limited authorized links; keep `.data/uploads` as the local-dev provider | [lib/data-dir.ts](lib/data-dir.ts) (rename → `lib/storage.ts`), [app/api/documents/[id]/file/route.ts](app/api/documents/[id]/file/route.ts) |
| 0.5 | Backups: provider PITR + nightly logical dump to object storage; **restore drill in CI** (restore to scratch DB, row-count assertions) | new `scripts/backup.ts`, `scripts/restore-verify.ts` |
| 0.6 |isme-free Tenant tests: seeded Firm A/Firm B fixture; assert every accessor, every mutating route, and a cross-firm file download returns 404/logged | new `tests/tenancy.test.ts` |
| 0.7 | Deployment: previews use a disposable per-branch DB; production DB is never touched by builds | `vercel.json`, `.env.example` |

**Exit criterion (plan):** multiple authorised users, two firms, concurrent writes, no cross-firm reads, restore verified.
**Exit criterion (repo):** `npm test` green in CI; delete the `/tmp` fallback only when the real backend is wired (`CA_DATA_DIR` becomes a local-dev-only path).

### P1 — Client & engagement engine

| # | Change | Files |
|---|---|---|
| 1.1 | `client_gstins` table (`gstin`, `state`, `filing_frequency`, `is_primary`); return-generation keys off registrations, not the single client `gstin` | [lib/db.ts](lib/db.ts), [lib/engagements-db.ts](lib/engagements-db.ts), [lib/services.ts](lib/services.ts), clients UI |
| 1.2 | **★ Versioned checklist templates**: `service_templates` table (firm-owned, revision-numbered); services instantiate `template_revision` so historical work references the checklist that was in force; UI to edit per firm | new [lib/templates.ts](lib/templates.ts), [lib/services.ts](lib/services.ts), new `app/api/templates/route.ts`, settings UI |
| 1.3 | Deadline override: `compliance.override_due_date` + reason column; changing it must recompute `next_reminder_at` on linked open document requests, and cancel/restore reminders, in the same transaction | [lib/db.ts](lib/db.ts), [lib/reminders.ts](lib/reminders.ts), [app/api/compliance/[id]/route.ts](app/api/compliance/[id]/route.ts) |
| 1.4 | **★ AY modelling for ITR**: explicit `assessment_year` column + period display split FY/AY per plan §6 ("not interchangeable") | [lib/services.ts](lib/services.ts), [lib/types.ts](lib/types.ts), workflow UI |
| 1.5 | Authoritative calendar source: keep computed default dates, allow per-client override with an "extension noted" flag; do not hard-code a universal date in generation | [lib/services.ts](lib/services.ts) |
| 1.6 | Workload balancing: `assignPreparer()` least-loaded by open `preparation` tasks; escalation after N days unactioned | [lib/workflow.ts](lib/workflow.ts), automation rules |

**Exit criterion:** onboarding a test client with GST only produces exactly GST work, once, even when re-run; a second client without ITR service produces zero ITR engagements.

### P2 — Real WhatsApp automation (close the four gaps)

| # | Change | Files |
|---|---|---|
| 2.1 | **Provider message idempotency**: store `wa_message_id` + `wa_status` + `wa_error` on `messages`; before retrying, look it up | [lib/db.ts](lib/db.ts) migration, [lib/whatsapp.ts](lib/whatsapp.ts) |
| 2.2 | **Inbound webhook**: `app/api/webhooks/whatsapp/route.ts` — GET hub verification + POST with `x-hub-signature-256` HMAC validation; inbound text → match client by `wa_id`/phone → record as inbound `messages` row (`kind: "inbound"`) → auto-create a staff follow-up task referencing the request; file attachments (support exists behind template/media permission) → attach to the best-matched open request **with staff confirmation when ambiguous** (plan: no silent AI assignment of documents) | new route; [lib/engagements-db.ts](lib/engagements-db.ts) helper `matchInbound()` |
| 2.3 | **Status webhook**: handle `statuses` events (`sent`, `delivered`, `read`, `failed` with error-code) → update `wa_status`/`wa_error`; a template acceptance is `Sent` (already the case), delivery requires the webhook | same route, [lib/whatsapp.ts](lib/whatsapp.ts) `markMessageStatus()` |
| 2.4 | **Multi-template map**: per-kind templates — `doc_request`, `doc_reminder`, `invoice_reminder`, `status_update` — env-configurable (`WHATSAPP_TEMPLATE_DOC` …) with per-template parameter order constants; keep one fallback template for pilot firms | [lib/whatsapp.ts](lib/whatsapp.ts), [lib/reminders.ts](lib/reminders.ts), [lib/billing.ts](lib/billing.ts) |
| 2.5 | **Reminder mention only outstanding items** (already implemented via `refreshRequestStatus` — keep) and **cancel-on-acceptance**: if a reminder is due and the request has cleared, it must be skipped (verify in tests; the sweep is idempotent by design) | assert in tests, no code change expected |
| 2.6 | **Escalation on exhaustion** (★ the one real gap in the reminder policy): third reminder sent → open a `staff_task` (kind `document_escalation`) assigned to the request's owner, visible on their queue; no fourth automated reminder | [lib/reminders.ts](lib/reminders.ts), [lib/workflow.ts](lib/workflow.ts) |
| 2.7 | Retry policy: transient cloud failures (network/5xx) exponential backoff (2/4/8 min, max 3 attempts) as a `jobs` table row consumed by the sweep; permanent 4xx marks `Failed` and stops retries | new `lib/jobs.ts`, [lib/whatsapp.ts](lib/whatsapp.ts), cron sweep |
| 2.8 | Cost ledger: per message kind count `template_name`, `category` (utility/marketing) and provider's pricing-category charge estimate; expose via reports endpoint | [lib/whatsapp.ts](lib/whatsapp.ts), [app/api/reports/route.ts](app/api/reports/route.ts) |
| 2.9 | **★ Flip the opt-in default** from `whatsapp_opt_in: 1` to `0` for new commercial clients; existing pilot rows migrate with a consent-review task | [lib/db.ts](lib/db.ts), [lib/engagements-db.ts](lib/engagements-db.ts) backfill |
| 2.10 | Cron sweep observability: every sweep writes a run summary; failed items list surfaced in the automation UI with the provider error text | [app/api/cron/automation/route.ts](app/api/cron/automation/route.ts), automation UI |

**Exit criterion:** complete messaging lifecycle tested once with real provider callbacks, including one forced failure, one opt-out, and one inbound reply that lands as a follow-up task on the right request.

### P3 — Filing workflow & billing remainder

| # | Change | Files |
|---|---|---|
| 3.1 | Mandatory review notes: `review_notes` required before a `review → filing` transition; rejection must always set `stage` to the correct prior stage, never to itself (already structural; add the text requirement + test) | [lib/workflow.ts](lib/workflow.ts), workflow UI |
| 3.2 | Two distinct checks that closing requires `ack_number` (exists) **and**, for manual filings, evidence attachment (workpaper link) | [lib/workflow.ts](lib/workflow.ts) |
| 3.3 | Per-role queue dashboards: partner (signoff/final reviews/exceptions), manager (review queue/team load), article (preparation queue/missing docs) — each a filtered view, not new tables | workflow UI, dashboard cards |
| 3.4 | Dunning connects to the reminder engine (billing→invoice→dunning→three reminders→escalation task), sharing one outbox and one opt-in rule | [lib/billing.ts](lib/billing.ts), [lib/reminders.ts](lib/reminders.ts) |
| 3.5 | Workflow bottleneck report: time-in-stage per service and preparer, SLA breach count, reminder-effectiveness (accepted-after-N-reminders curve) | [app/api/reports/route.ts](app/api/reports/route.ts), reports UI |

**Exit criterion:** a complete GST engagement runs documents → preparation → review (with a returned rework cycle) → sign-off → filing → ack recorded → auto-invoice created once → closure; audited end to end.

### P4 — Reliability & security hardening

| # | Change | Files |
|---|---|---|
| 4.1 | **Introduce `vitest`** with two suites: fast unit tests (services/billing/workflow/reminders against a temp `CA_DATA_DIR`) and integration tests per the plan's 15 acceptance scenarios; wire into CI (`npm run test`) | new `tests/*`; add `"test": "vitest run"` |
| 4.2 | Map the plan's 15 acceptance tests to cases (see §6); the ones that already pass by architecture get regression tests; the four real gaps (escalation task, retry idempotency, cross-firm denial, reminder cancellation on acceptance timing) become the tests that drive P2/P3 code | `tests/acceptance/*.test.ts` |
| 4.3 | Concurrency: run the reminder sweep twice in the same tick (parallel requests) → assert exactly one logical action (exploit the existing idempotency keys; add `automation_key` unique index where missing) | [lib/db.ts](lib/db.ts), tests |
| 4.4 | Structured logs (JSON with `request_id`, `actor`, `firm_id`) + an error tracker (Sentry or self-hosted GlitchTip) + a job-health endpoint `GET /api/ops/health` that the cron monitor can ping | [proxy.ts](proxy.ts), new `lib/log.ts`, `app/api/ops/health/route.ts` |
| 4.5 | Access-boundary verification matrix: script every API path × every role and assert expected 200/401/403 — turns the audit's manual verification into a regression suite | `tests/routes-matrix.test.ts` |
| 4.6 | Retention & deletion: implement on request the erasure flow that also scrubs object-storage versions; add a `retention_policy` settings per firm | [lib/db.ts](lib/db.ts) + storage module |
| 4.7 | DPDP: get the consent flow, processor contracts and retention policy reviewed (plan §D) — policy work, not code | docs |

**Exit criterion:** full CI (typecheck + tests + route matrix + tenancy + restore drill) on every PR.

### P5 — Commercial readiness

| # | Change | Files |
|---|---|---|
| 5.1 | Firm self-serve onboarding wizard (create firm → users → service templates → WhatsApp connect → import clients) | new `app/onboarding/*`, [lib/onboarding.ts](lib/onboarding.ts) extension |
| 5.2 | Plans & limits: `firms.plan`, usage counters, enforced caps (users, messages/month), Razorpay/Stripe for INR subscription billing | new [lib/billing-saas.ts](lib/billing-saas.ts) (distinct from the practice's GST invoicing) |
| 5.3 | SaaS admin surface: tenants, usage, suspension, data export per firm | new `app/admin/*` (or an ops-only endpoint first) |
| 5.4 | Support diagnostics: anonymised run log export per firm (CSV) for support requests | ops endpoint |
| 5.5 | Restore drill documented + tested; incident runbook (webhook outage, provider 4xx burst, migration roll-forward) | `docs/OPS.md` |

**Exit criterion:** a firm can onboard itself via the wizard, run one full GST cycle, and be supported without the developer touching their data.

---

## 6. Acceptance-test mapping — plan §10 vs audited reality

| Plan scenario | Status today | Note |
|---|---|---|
| Create client + activate GST → tasks generated once | ✅ by design (`ensureCurrentCycles` idempotency) | needs test |
| Client without active ITR service → no ITR work on new FY | ✅ by design (generation iterates enrolled services only) | needs test |
| Client uploads 1 of 5 docs → reminder mentions rest only | ✅ implemented (`refreshRequestStatus`) | needs test |
| All accepted before a reminder → no message | ✅ by design (sweep checks pending first) | needs test — watch a race between upload and sweep tick |
| Three reminders → no fourth, escalation task created | ◐ cap 3 + stop are implemented, **escalation task is missing** | drive P2.6 |
| Provider timeouts → safe retry, no duplicate send | ✖ no provider message-id, no retry queue | drive P2.1/P2.7 |
| Client opts out → suppressed | ✅ enforced in `lib/reminders.ts` + `lib/billing.ts` | needs test |
| Accountant submits → reviewer gets task | ✅ implemented (`lib/workflow.ts`) | needs test |
| Reviewer rejects → returns to correct stage with history | ✅ structural | mandatory-notes text (P3.1) needs test |
| Approved but not filed → stays unfiled | ✅ implemented | needs test |
| Filing without evidence → blocked or exception | ✅ implemented (no closing without ack) | needs test |
| Invoice paid in full → reminders stop | ✅ implemented | needs test |
| DB restarts → records/files/jobs recoverable | ✖ blocked by `/tmp` persistence | **P0.1–P0.5** |
| Firm A requests Firm B's file → denied + logged | ✖ not applicable today — no tenancy | **P0.3 + P0.6** |
| Recurring job runs twice → one logical event | ✅ for engagements (idempotent); ◐ for messages (`automation_key` exists, no unique constraint) | drive P4.3 |

**Test automation status:** none exists; everything above is verified by code inspection only. The first CI step is P4.1.

---

## 7. Revised release order (what to build next, concretely)

1. **P0 first, nothing else until `npm test` exists.** Even a minimal `vitest` + tenancy + restore-verify suite de-risks every later change more than any feature.
2. **Then P2's four WhatsApp gaps** (2.1–2.3, 2.6) — the plan's flagship differentiator only *becomes* differentiating when delivery is real, replies are captured, and duplicates are impossible.
3. **Then P1's three engines upgrade** (multi-GSTIN, versioned templates, deadline override) — these are the highest-leverage firm-config features.
4. **Then P3** (mandatory notes, queue dashboards, dunning closure).
5. **P4 continuously; P5 only after a pilot firm survives two full cycles on the production stack.**

## 8. What NOT to build

Converts the plan's cautions into code-zero rules:

- **Do not extend AI authority** — the existing approval-gated copilot is already the right shape; add only read-only workflow assists.
- **Do not promise automated government filing** — `ack_number`/manual-evidence recording is honest and should remain the only "filing" surface until an authorised integration is tested end to end.
- **Do not build the client portal, payment gateway or e-sign before P0 finishes** — they sit on the persistence layer that must exist first.
- **Do not delete the keyless AI paths or the queue-first WhatsApp path** — they are the commercial fallback when provider credentials lapse, and they already work.

---

*Sources for every claim in §1–§4: direct reads of the listed files at the paths shown, plus live HTTP checks recorded in this conversation. The stale v3.1 report should be superseded by this document; [CADocs-Report.md](CADocs-Report.md) remains the commercial-facing summary.*
