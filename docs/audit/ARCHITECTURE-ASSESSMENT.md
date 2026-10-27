# Architecture Assessment — NexAgent / CADocs (24 Oct 2026)

## Current application architecture

Next.js 16 App Router, all server-rendered, TypeScript strict, Tailwind 4. A single runtime process couples four concerns in one package:

```
browser ─► proxy.ts (Node runtime; auth+roles+CSRF+rate-limit)
             └─► app/ (RSC pages, one per module)
                   └─► app/api/* (57 route handlers; validation in lib/api.ts)
                         └─► lib/ (domain)
                               ├─ lib/db.ts (SQLite via node:sqlite + schema + seed + audit)
                               ├─ lib/engagements-db.ts (client-services / doc-request packets / task events)
                               ├─ lib/services.ts (service catalogue, cycles, FY)
                               ├─ lib/workflow.ts (stage machine, role-staged gates)
                               ├─ lib/reminders.ts (reminder engine, cap 3)
                               ├─ lib/billing.ts (auto-invoice on completed cycle)
                               ├─ lib/whatsapp.ts (queue + Cloud API dual path)
                               ├─ lib/automation.ts (six rule types, sweep, dry-run, NL planner)
                               ├─ lib/ai-* (agent/tools/prompts/providers)
                               └─ lib/data-dir.ts (where everything on disk lives)
```

**State lives in one SQLite file** + `.data/` (keys, uploads), chosen by `lib/data-dir.ts`: `.data/` locally, `/tmp/ca-suite` when `VERCEL` is set. Two background drivers exist: the daily sweep ([app/api/cron/automation/route.ts](../../app/api/cron/automation/route.ts)) and the "Run now"/preview buttons, both converging on `runAutomationSweep()` + `runClientAutomation()`.

## Request/data flow (verified)

1. Every request hits `proxy.ts` → session verified against SQLite user row per request (cheap, correct, no cache staleness).
2. Pages are RSC — reads go straight from page → `lib/*` → SQLite (no internal fetch round-trips for server components).
3. Mutations are REST handlers under `/api/*`, validate via `lib/api.ts`, write through typed accessors, insert `audit_log` rows on create/status change, then `router.refresh()` resyncs server components.
4. AI writes never touch DB directly: handler → `ai_actions` (pending) → on approve, re-validation → tool execution → audit rows.

## Current automation architecture

- **Trigger:** Vercel Cron daily 03:30 UTC (`vercel.json`) → `GET /api/cron/automation` with secret/marker auth.
- **Engine:** elapsed-time cadence (daily ≥1 day / weekly ≥6 / monthly ≥27) — self-heals missed days; per-rule and batch run/preview; dry-run writes nothing.
- **State:** `automation_rules` + `automation_runs` rows; outbox lives on `messages` (`status: Queued`).
- **Policy:** a rule is a standing approval; `auto` executes low-risk reversible work, `approval` mode defers every instance to `ai_action` review.
- **Client engine:** `lib/reminders.ts` runs under the same sweep — creates current cycles, queues the initial request and gap-based reminders, hard caps at 3, stops when packets clear, then auto-bills completed cycles.

**Concurrency model (single-writer):** SQLite in rollback-journal mode — safe single-instance, but not multi-instance. Docker/SQLite "single writer" is the architecture's core assumption; serverless multi-instance violates it, which is the persistence blocker (B1/S2).

## External integration points

| Integration | Today | Honest boundary |
|---|---|---|
| WhatsApp | queue (`wa.me`) + Cloud API **template send** when creds + `WHATSAPP_AUTO_SEND=1` | single template; no inbound/status webhooks; no provider message id; accepts-≠-delivered documented in-code |
| Email | `mailto:` deep-links + same outbox | no auth email provider |
| AI providers | Gemini → Groq → OpenRouter → NVIDIA, first key wins; deterministic fallback always available | no provider tool-calling exercised without a key (code-complete) |
| Government (GST/MCA/IT) | not integrated — manual filing with `ack_number` evidence recorded | correctly deferred |
| Payments | recorded (modes + reference), auto-invoice | no gateway; no delivery webhooks |
| Storage | local FS under `data-dir()` | no object store; ephemeral on Vercel |

## Recommended production architecture for a multi-firm CA SaaS

Preserve the existing shape; change the spine it runs on.

```
                     ┌──────────────── CDN/edge (static, /site) ───────────────┐
                     │  Next.js (Vercel or VM) — pages, API routes, RSC        │
   session cookie ─► │  proxy: verify session, resolve firm, roles, CSRF       │
                     └──────────┬─────────────────────────────────────────────┘
                                │  firm-scoped accessors only
                       ┌────────┴────────┐         ┌───────────────────┐
                       │ Postgres (firm_id everywhere) │  Object store (R2/S3)  │
                       │ migrations, PITR │         │ private, signed URLs   │
                       └────────┬────────┘         └────────┬──────────┘
                                │   durable queue (pg-boss / QStash-style)
                                ▼
                     Worker(s): reminder engine, WhatsApp send/retry,
                                status+inbound webhook handlers, escalation tasks
```

- **Database:** Postgres (Vercel Postgres/Neon/Supabase). Concurrency, PITR, and a real migration ledger are exactly what SQLite-in-`/tmp` cannot give. Numbered migrations with `schema_migrations`; CI runs schema-only against Postgres and SQLite to catch drift.
- **Jobs:** move from "one cron tick" to a durable queue with retry/poison/dead-letter semantics (pg-boss on Neon, QStash, or Vert-style). The current daily sweep remains the top-level trigger; the queue owns retries, which the plan demands for sends.
- **Object storage:** private bucket with signed, expiring links; per-firm prefixes; retention policy.
- **Secrets:** managed secret store replaces auto-generated `.data/*.key` files in multi-instance hosting (they'd diverge).
- **Optional drastic simplification for cohort 1 (10–20 firms):** one dedicated small VM per firm running the current app + its own SQLite + volume. Sidesteps tenancy work but forgoes SaaS ops; keep as a documented fallback, not the target.

## Components to preserve / modify

| Preserve as-is | Modify | Replace/Add |
|---|---|---|
| `lib/services.ts` catalogue & FY logic | `lib/db.ts`/`lib/engagements-db.ts` — hoist SQL, add `firm_id`, add migrations | Postgres engine + migration runner |
| `lib/workflow.ts` stage machine + role gates | `lib/whatsapp.ts` — multi-template map, provider-id, retries | durable job queue |
| `lib/reminders.ts` policy & engine | `lib/crypto.ts` — multi-instance rate limits | object storage module |
| `lib/billing.ts` idempotent invoicing | `lib/data-dir.ts` → `lib/storage.ts` | inbound + status webhook routes |
| `lib/ai-*` (whole copilot layer) | `automation.ts` — per-firm locking | tests + CI + error tracking |
| `proxy.ts` model (Node runtime request gate) | every route (via accessors) for `firm_id` | SaaS admin surface |
| Public site & demo-lead capture | `next.config.ts` (only to serve optional MFA flows later) | subscription/plan limits |

## Evidence base

Component claims reflect direct code reads of the above modules plus 57 API routes listed in [DATABASE-AND-API-INVENTORY.md](DATABASE-AND-API-INVENTORY.md); deployment behaviour is documented in the audit conversation log (no code changes were needed to demonstrate this — existing state was measured as-is).
