# Implementation Roadmap — NexAgent / CADocs (audit-grounded)

Order is dependency-true: nothing is scheduled before the store it runs on exists. This replaces the original 15-phase sequence's pre-audit assumptions with what the code proves already exists.

## Phase 1 — Test harness + migrations ledger (new hurdle, before any feature work)

**Objective:** make every later change verifiable and deployable.
**Files:** new `lib/migrations.ts` + `migrations/0001_init.sql` (extracted from [lib/db.ts](../../lib/db.ts) boot `CREATE/ALTER`s); new `tests/` with `vitest`; `"test": "vitest run"` in [package.json](../../package.json).
**DB:** introduce `PRAGMA user_version` (SQLite) / `schema_migrations` (Postgres) runner; backfills move out of the boot path.
**API/UI:** none.
**Acceptance:** `npm test` green in CI; schema changes to any future phase require a migration file, enforced by review convention.
**Tests:** the plan's 15 scenarios where they already apply to current behaviour (reminder cap, no-ITR-no-work, idempotent generation, closure-without-ack refusal) as regression cases.

## Phase 2 — Persistent database, storage and recovery *(Prompt 02 focus)*

**Objective:** kill B1/S2.
**Decision needed from owner:** managed Postgres (recommended) vs firm-dedicated VM + SQLite-volume.
**Files:** [lib/data-dir.ts](../../lib/data-dir.ts) → split into `lib/storage.ts` (object storage: R2/S3, signed URLs, per-firm prefixes) and a data-source module; [lib/db.ts](../../lib/db.ts)/[lib/engagements-db.ts](../../lib/engagements-db.ts) keep their public APIs while the SQL moves behind typed accessors (already partially so).
**New:** nightly logical dump + **restore drill in CI**; `scripts/backup.ts`, `scripts/restore-verify.ts`.
**API/UI:** uploads route switches to object storage; download becomes a signed link ([app/api/documents/[id]/file/route.ts](../../app/api/documents/[id]/file/route.ts)).
**Risks:** SQL dialect drift (CI runs schema-only under both engines); connection-per-lambda (use pooled connection env in provider docs).
**Acceptance:** records survive sleep/recycle; two instances share data; restore drill green.

## Phase 3 — Authentication, tenant isolation & permissions *(Prompt 03 focus; auth exists, isolation doesn't)*

**Objective:** multi-firm safety (S3).
**Files:** every accessor adds `firm_id = ?`; [lib/auth.ts](../../lib/auth.ts) carries `firm_id` on the session; [proxy.ts](../../proxy.ts) rejects firm-less claims.
**Fix S1 in the same phase:** identifier columns in `/api/export?type=clients` gated to partner (or redacted); audit log entries on identifier exports.
**Fix S5:** per-IP/proxy edge limit; or same-DB-backed limiter once Postgres exists.
**Tests:** Firm A/Firm B fixture; route×role×method matrix (kills S1/S7 ambiguities).

## Phase 4 — Client onboarding & service configuration *(Prompt 04)*

**Objective:** close the multi-registration + consent-default gaps.
**Files:** new `client_gstins`; consent default `whatsapp_opt_in: 0` for new clients (backfill care in [lib/db.ts](../../lib/db.ts)/[lib/engagements-db.ts](../../lib/engagements-db.ts) — do not silently flip existing rows without notice); UI onboarding form; [lib/onboarding.ts](../../lib/onboarding.ts) additions.
**Acceptance:** a client can have 2 GSTINs with distinct filing frequencies; no existing consent silently drops.

## Phase 5 — Recurring engagement & compliance engine *(Prompt 05)*

**Objective:** versioned templates + deadline overrides + AY modelling.
**Files:** `service_templates` (firm-scoped, revision-numbered) + `compliance.override_due_date`/reason; [lib/services.ts](../../lib/services.ts) reads template revisions; [lib/reminders.ts](../../lib/reminders.ts) recalculates `next_reminder_at` on override changes in the same transaction; explicit AY columns for ITR periods.
**Acceptance:** override reflows reminders; a template edit does not reinterpret historical work.

## Phase 6 — Secure document management *(Prompt 06)*

**Objective:** content-sniff validation (S4), versioning, retention.
**Files:** [app/api/documents/[id]/file/route.ts](../../app/api/documents/[id]/file/route.ts) (MIME/magic-byte check; keep endpoint-only extension allow-list as defence 2); `document_versions` table; retention policy per firm.
**Acceptance:** polyglot/empty/mis-declared uploads rejected; prior version retrievable until retention expiry.

## Phase 7 — Staff assignment, review & filing workflow *(Prompt 07)*

**Objective:** mandatory review notes, rejection correctness, workload balancing, per-role queues.
**Files:** [lib/workflow.ts](../../lib/workflow.ts) (require `review_notes` before leave-review transition; guard preparer≠reviewer explicitly); workflow UI queue views; assignment util + escalation (P1 of original plan).
**Acceptance:** returned rework lands on the correct prior stage; queues filter by role.

## Phase 8 — WhatsApp Business integration (real) *(Prompt 08 focus)*

**Objective:** close the four gaps (R6) — inbound + status webhooks, provider-id idempotency, retries, per-kind templates.
**Files:** new `app/api/webhooks/whatsapp/route.ts` (HMAC-verified GET/POST), [lib/whatsapp.ts](../../lib/whatsapp.ts) (template map, `wa_message_id`/`wa_status`/`wa_error` on [lib/db.ts](../../lib/db.ts) `messages`), retry queue rows in Phase-2 storage.
**Business-policy alignment:** this is a Meta platform integration — template approvals, opt-in capture and pricing categories are Meta-side work; drive S1/P7 first and only attempt this late (needs a working webhook to test genuinely).
**Acceptance:** forced provider failure → safe retry with no duplicate send; inbound reply creates a correctly-attributed staff task (or a confirm-match state when ambiguous).

## Phase 9 — Automated document collection & reminders *(Prompt 09)*

**Objective:** escalation on reminder exhaustion (R7) + timing fixes.
**Files:** [lib/reminders.ts](../../lib/reminders.ts), staff-task creation on 3rd-reminder exhaustion, agent-visible queues.
**Acceptance:** 3-then-stop + task; race between upload completion and sweep tick does not double-send (test).

## Phase 10 — Billing & collections *(Prompt 10)*

**Objective:** delivery-aware dunning + invoice-delivery tracking; gateway deferred until pilot.
**Files:** [lib/billing.ts](../../lib/billing.ts) (due-date calculation + milestone trigger partitioning), automation rules connecting dunning→escalation; report columns for delivery status.

## Phase 11 — Annual ITR & audit workflows *(Prompt 11)*

**Objective:** annual engagements on the same engine; closure checklist for audits.
**Files:** [lib/services.ts](../../lib/services.ts) annual templates and audit's explicit milestone list; AY field from Phase 5.

## Phase 12 — AI workflow assistance *(Prompt 12; existing layer is the strong base)*

**Objective:** keep approval-gated AI; add read-only assists on the new queues (never new write bodies).
**Files:** new tools limited to read/kick actions inside [lib/ai-tools.ts](../../lib/ai-tools.ts); prompts updated to surface workflow-stage awareness.

## Phase 13 — Reporting & dashboards *(Prompt 13)*

**Objective:** workflow bottleneck / reminder-effectiveness / SLA metrics; per-role dashboards.
**Files:** [app/api/reports/route.ts](../../app/api/reports/route.ts), dashboards.

## Phase 14 — Security, reliability & acceptance *(Prompt 14)*

**Objective:** prove it.
**Files:** full route matrix, concurrency tests (queue double-fire), chaos on webhook failure, migration roll-back test, DPDP retention/erasure spec; **DPDP/compliance sign-off from legal counsel** — a policy task, not code.

## Phase 15 — Commercial SaaS readiness *(Prompt 15)*

**Objective:** self-serve onboarding, plan limits, support ops.
**Files:** `firms.plan`, usage counters, SaaS admin surface, subscription integration (Razorpay/Stripe), support diagnostics export.

---

## Dependency map (why this order)

```
Phase 1 (tests+migrations) ─┬─► Phase 2 (persistence) ─► Phase 3 (tenancy)
                             └─► Phase 4-7 (client/workflow engine — independent of Phase 8+)
Phase 3 ─► Phase 8 (WhatsApp needs firm context for template params + per-firm opt-ins) ─► Phase 9-10
Phase 5 (templates/AY) ─► Phase 11 (annual ITR/audit)
Phase 2 ─► Phase 14 (recovery drills need real backend) ─► Phase 15
```

## Explicitly NOT in any phase (gating reasons)

- **Payment gateway / client portal / e-sign** — Phase 15+; blocked until persistence+tenancy are real and a pilot firm is active.
- **Government filing integrations** — deferred by design; manual ack evidence is recorded honestly today.
- **MFA** — recommend at Phase 14; requires session-flow work and policy sign-off first.
