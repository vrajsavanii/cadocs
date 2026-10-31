# End-to-End Workflow Map — NexAgent (Verification V1)

Each workflow is traced from UI entry point → API → business logic → database → background/external
events → resulting UI state. States: **Traced+verified** (evidence noted), **Traced** (code path read,
not executed in V1), **Partially traced**, **Blocked**, **Not implemented**.

Legend for evidence: [T] passing test, [S] smoke probe, [C] code reading.

---

## Workflow A — Firm and staff setup

- **Preconditions:** fresh database (`.data/ca-suite.db`), boot seed runs `seedUsersIfEmpty`.
- **Sequence:** boot creates 3 seeded users (partner `admin`, manager `manager`, article `staff`),
  writes `.data/bootstrap-credentials.txt` (0600) when passwords were not supplied via
  `ADMIN_PASSWORD`/`MANAGER_PASSWORD`/`STAFF_PASSWORD` env vars → `/settings` (partner) manages users
  via `GET/POST /api/users` → each role logs in at `/login`.
- **DB:** `users` (password_hash bcrypt-style via `lib/crypto.ts`, `token_version`, `role`).
- **Audit:** `audit_log` rows `LOGIN`, `LOGIN_FAILED`.
- **Expected role access:** partner everything; manager blocked from `/api/settings`, `/api/users`
  and `DELETE /api/clients`; article read + own timesheets/messages/workflow PATCH.
- **Evidence:** [S] all three logins 200; staff GET/POST `/api/users` → 403; staff POST
  `/api/invoices|/api/settings|/api/payments` → 403. [T] `auth-policy.test.ts`.
- **Gaps:** no invitation flow, no firm-creation flow (single seeded firm "Sharma & Associates"),
  password-change path not runtime-tested in V1.
- **Status:** Traced+verified (role gate), Traced (password change).
- **Cleanup:** dev DB only; no production impact.

## Workflow B — Client onboarding

- **Sequence:** `/clients` → New client (`views/onboard-wizard.tsx`) → `POST /api/clients` →
  registrations `POST /api/clients/[id]/registrations` → services `POST /api/client-services` →
  activation `POST /api/clients/[id]/onboarding` (idempotent) → client appears in `/clients` list
  and dashboards.
- **DB:** `clients`, `client_registrations` (PAN/GSTIN encrypted), `client_services`,
  `client_service_assignments`, `onboarding_activations`, `onboarding_tasks`, `audit_log`.
- **Evidence:** [T] `onboarding.test.ts` 14 tests — two registrations produce one engagement each,
  duplicates/foreign-client registrations rejected, activation retried safely, pause/cancel keeps
  history, outsider writes rejected, independent reviewer enforced, completeness assessment ignores
  cancelled engagements. [S] `GET /api/clients` 200.
- **Status:** Traced+verified (unit/integration level). Browser-level wizard clicks **not** exercised.

## Workflow C — GST return preparation (full lifecycle)

- **Sequence:** engagement generated from client service (Workflow D) → `/compliance` list →
  document request `POST /api/document-requests` → WhatsApp message queued/sent (Workflow G) →
  documents uploaded (Workflow E) → checklist verified → stage advances through
  `views/workflow.tsx` (`PATCH /api/workflow/[id]`: prepare → submit → review → corrections →
  approve) → filing evidence recorded **separately** from completion → partner closes.
- **DB:** `compliance`, `compliance_status_history` (append-only, update/delete triggers abort),
  `task_assignments`, `task_events`, `task_blockers`, `documents`, `document_requests`, `jobs`.
- **Guard rails found in code:** stage order never skips review; reviewer ≠ preparer per service
  policy; only partner closes and only after filing evidence; stale writes (version mismatch)
  rejected; statutory due date remains `unverified` until a partner verifies the rule.
- **Evidence:** [T] `staff-workflow.test.ts` (19) + `recurrence.test.ts` (16) cover these exact
  assertions. [S] `/workflow`, `/compliance` pages 200; `/api/workflow` 200.
- **Not executed in V1:** the browser click-path end to end; real filing integration (there is
  **no GST portal integration** — filing evidence is a manually recorded reference by design).
- **Status:** Traced+verified at API/logic layer; UI click-path Not verified.

## Workflow D — Recurring compliance generation

- **Sequence:** service with frequency configured → `POST /api/engagements/generate` (manual) or
  `GET /api/cron/recurrence` (scheduled, 04:00 via `vercel.json`) → engine computes periods from
  `due_date_rules` → inserts `compliance` rows idempotently → writes `engagement_generation_runs`
  summary.
- **Evidence:** [T] `recurrence.test.ts` — rerun creates no duplicates, registration-aware,
  paused/inactive/out-of-window services skipped. [S] cron route 401 without secret.
- **Defect:** cron authorization falls back to spoofable `x-vercel-cron` header — DEF-001.
- **Status:** Traced+verified (engine), Partially working (scheduled auth).

## Workflow E — Document management

- **Sequence:** `/documents` upload (`views/documents.tsx` → `POST /api/documents`, multipart to
  `/api/documents/[id]/file`) → stored under `CA_DATA_DIR/uploads` (0600, object-key safety in
  `lib/storage.ts`) → review states Pending/Received/Rejected/Verified → version history
  `POST /api/documents/[id]/versions` → download via `/api/documents/[id]/file` (permission-checked).
- **Evidence:** [T] `documents.test.ts` (7), `storage.test.ts` (4), `persistence.test.ts` (3).
  [S] path-traversal probe `../../../etc/passwd` → 404.
- **Status:** Traced+verified.

## Workflow F — Staff assignments and approvals

- **Sequence:** assignment recorded on engagement creation → reassignment appends ledger row
  (previous assignee preserved) → prepare → submit → review; reject requires written reason;
  unauthorized transitions rejected by role and separation-of-duties policy; partner-only reopen.
- **Evidence:** [T] `staff-workflow.test.ts` 19/19 including stale-write and fourth-party-approval
  rejection. [S] staff `POST /api/workflow` allowed only for PATCH-eligible routes at proxy —
  in-depth checks inside handler verified by tests.
- **Status:** Traced+verified.

## Workflow G — WhatsApp document collection

- **Sequence:** document request created → `lib/whatsapp.ts#deliverWhatsApp` queues a `messages`
  row → if `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` + template + `WHATSAPP_AUTO_SEND=1`:
  Graph API template send; otherwise stays Queued with a `wa.me` deep link → receipt of documents
  flips requirement status → reminder rules respect `whatsapp_opt_in` and reminder limits.
- **Evidence:** [T] billing tests cover eligibility gating and outbox-only-when-unconfigured.
  [S] local `.env` has no `WHATSAPP_TOKEN` → queue mode (safe: no real messages can be sent).
- **Gaps:** **no webhook route**, so provider delivery/read/failure callbacks never update status;
  `markMessageStatus` is only called from the send response. Statuses therefore stop at
  Sent/Failed — DEF-002-class disconnect (registered as DEF-004).
- **Status:** Partially working — queue verified, cloud send Blocked by configuration,
  status processing Disconnected.

## Workflow H — Invoice and payment

- **Sequence:** `/invoices` → draft `POST /api/invoices` (GST split by place-of-supply) → approval
  `POST /api/invoices/[id]/lifecycle {decision: approve}` (self-approval blocked) → issue (number
  allocated inside `BEGIN IMMEDIATE` transaction) → payments `POST /api/payments` (partial allowed,
  over-payment refused) → balance derived from ledger → reversal = correcting entry → credit note
  partner-only → receivables report and CSV export reflect it.
- **Evidence:** [T] `billing.test.ts` 18/18. [S] `GET /api/invoices` 200; CSV export of invoices
  produced correct rows (INV-2026-012 ₹28,320 pending); staff POST `/api/invoices` 403.
- **Payment gateway:** none exists — F-68 Not implemented (no provider success is ever claimed).
- **Status:** Traced+verified.

## Workflow I — Annual ITR

- **Sequence:** same generic service path as Workflow C with annual frequency and FY/AY period
  fields (`period_type`, `assessment_year` backfilled by migration).
- **Evidence:** [T] recurrence tests cover annual periods; `compliance` schema carries
  `assessment_year`.
- **Gap:** no dedicated ITR module (documents/steps specific to ITR) — Prompt 11 scope; only
  generic service rows.
- **Status:** Traced (generic path verified), dedicated workflow Not implemented.

## Workflow J — Tax audit

- Same as Workflow I: represented as a service line in `lib/services.ts`, working papers are
  ordinary documents, review stages are the generic workflow.
- **Status:** Traced (generic), dedicated audit programme Not implemented.

## Workflow K — AI Copilot

- **Sequence:** `/agent` → `POST /api/ai/chat` (session required; daily quota) → tool registry
  `lib/ai-tools.ts` → read tools answer directly; **write tools create an `ai_actions` pending
  row** → user approves via `POST /api/ai/actions/[id]` → approval re-runs ownership, pending
  status, current role, schema validation, and domain validation → executes → `ai_calls` audit.
- **Evidence:** [S] unauth `POST /api/ai/chat` → 401; `GET /api/ai/usage` 200. [C] gates read in
  route source.
- **Gaps:** **no automated tests for the AI layer at all**; unauthorized-read and unapproved-write
  behavior not runtime-probed in V1 (scheduled for V2 per VERIFICATION-ROADMAP); provider calls are
  keyless locally for the deterministic fallback.
- **Status:** Traced, Not verified.

## Workflow L — Reporting

- **Sequence:** `/reports` → `GET /api/reports` with filters (date range, FY, AY, client, service,
  staff, invoice/payment status — validated server-side) → `lib/reports.ts` aggregates from the
  same source tables the detail views use → CSV export `GET /api/export?type=…` applies the same
  filter set.
- **Evidence:** [T] `reports.test.ts` 12/12 — dashboard totals reconcile against detail records;
  financial-year boundaries (1 Apr–31 Mar) asserted; client de-duplication with multiple
  registrations asserted; tenant/permission scoping asserted. [S] `/api/reports` 200,
  `/api/export?type=invoices` 200 with correct rows, invalid type → 400.
- **Gap:** export-vs-dashboard parity verified in unit tests, not with identical live HTTP filter
  round-trips (planned V2).
- **Status:** Traced+verified.

## Workflow M — Automation and exception handling

- **Sequence:** rules defined via `/api/automation` → manual run `POST /api/automation/run` or
  scheduled sweep `GET /api/cron/automation` → each run recorded in `automation_runs` with
  actions taken → retries via `lib/jobs.ts` durable queue (`jobs` table) → cadence gate prevents
  double-running within window.
- **Evidence:** [T] `jobs.test.ts` (durable queue) 5/5. [S] local sweep executed: "9 rule(s) run,
  114 action(s) taken" recorded with summary; cron without secret → 401.
- **Defect:** spoofable cron header allowed the sweep to be invoked unauthenticated locally
  (DEF-001). Safe failure/retry of a deliberately failing job **not** simulated in V1.
- **Status:** Partially working (execution verified; failure-injection and auth defect).

## Workflow N — Firm subscriptions and entitlements

- **Finding:** no `plans`, `subscriptions`, `entitlements`, or `firms` tables; the only quota in
  the system is the AI daily limit (`AI_DAILY_LIMIT`).
- **Status:** Not implemented (Prompts 14–15 scope). Nothing to test in V1; recorded as a
  commercial-readiness gap, not a defect.

## Workflow O — Recovery

- **Sequence:** `npm run backup` → `.backups/ca-suite-<timestamp>.db` + `backup-manifest.json` +
  keys → `npm run backup:verify` (restore into a disposable directory and open it) → smoke tests.
- **Evidence:** [T] `backup.test.ts` 2/2; `.backups/` contains a real manifest + backup from
  2026-10-24. A full restore-into-disposable-environment drill with post-restore smoke tests was
  **not executed** in V1 (planned V2 — the tooling exists and is unit-verified).
- **Status:** Partially verified.

---

## Workflows blocked in this environment

| Workflow | Blocker |
|---|---|
| G (cloud sends) | `WHATSAPP_TOKEN`/`PHONE_NUMBER_ID`/template not configured anywhere → only queue mode possible; **no real messages may be sent from any environment used for testing** |
| K (live model answers) | no provider API keys on Vercel; local keys exist in `.env.local` but provider calls intentionally not exercised with real spend in V1 |
| N | feature not implemented |
| I / J (dedicated modules) | not implemented — generic path only |
| Production-scale restore drill | requires an isolated disposable environment (see ENVIRONMENT-AND-TEST-DATA-PLAN.md) |