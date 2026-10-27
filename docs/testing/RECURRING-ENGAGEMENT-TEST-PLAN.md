# Recurring Engagement — Test Plan & Results

**All results below were executed in this workspace.** Commands are reproducible from
the repository root.

## Commands and actual results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **pass** (exit 0, no diagnostics) |
| `npx vitest run` | **pass** — 9 files, 54 tests, 0 failures (≈20 s) |
| `npm run build` (Next 16 production build) | **pass** (exit 0; `/compliance`, `/workflow`, all `/api/engagements*` routes compiled dynamic) |
| HTTP verification against `next start` (see below) | **pass** |

> Observation for CI: on the very first cold run in a fresh checkout, 4 tests in
> `tests/jobs.test.ts` and `tests/storage.test.ts` hit the 5 s default timeout during
> parallel cold start; the same suite passed in full on every subsequent run. If you
> run these suites in CI, keep them on warm workers or raise `testTimeout`.

## Suite inventory

| File | Covers |
|---|---|
| `tests/recurrence.test.ts` | **Prompt 5 core** — period/FY/AY arithmetic, due-date rules, idempotent generation, workflow evidence, permissions, queries/jobs/migration |
| `tests/auth-policy.test.ts` | edge policy: cron routes reachable, articles limited to `PATCH` on engagements, generation manager+, unchanged denials |
| `tests/onboarding.test.ts` | Prompt 4 regression: activation idempotency, registrations, assignments, billing validation, history preservation |
| `tests/client-migration.test.ts` | Prompt 4 legacy GSTIN backfill without claimed verification |
| `tests/jobs.test.ts` | durable queue: logical-key idempotency, backoff retry, dead-lettering, stale-job recovery |
| `tests/persistence.test.ts` | restart survival of clients, users, jobs |
| `tests/backup.test.ts` / `tests/storage.test.ts` | snapshot verification, object storage versioning |
| `tests/config.test.ts` | durable-storage policy guards |

## Prompt 5 requirements → test mapping

| # | Requirement | Test (all in `tests/recurrence.test.ts` unless noted) | Result |
|---|---|---|---|
| 1 | FY and AY calculation | `calculates Indian FY boundaries and assessment years` | pass |
| 2 | Monthly/quarterly/half-year/annual boundaries | `finds the last completed period for every supported frequency` | pass |
| 3 | Bounded window, no invented periods | `enumerates a bounded window and never invents a period` | pass |
| 4 | Unverified defaults never labelled statutory | `ships unverified planning rules and never calls them statutory` | pass |
| 5 | Verified rule only inside its window | `uses a verified rule only inside its effective window` | pass |
| 6 | Conflicting verified rules refused | `does not choose between conflicting verified rules` | pass |
| 7 | Idempotent generation + progress preserved on rerun | `creates one registration-aware engagement, reruns safely and preserves progress` | pass |
| 8 | Registration-aware (two GSTINs, one client) | `creates separate engagements for two GST registrations without duplicating the client` | pass |
| 9 | No work for paused/out-of-window services | `never generates work for paused, inactive or out-of-window services` | pass |
| 10 | Exceptions instead of guessing | `flags paused clients and missing GST registrations instead of guessing` | pass |
| 11 | Filing evidence ≠ task completion | `requires filing evidence and records it separately from task completion` | pass |
| 12 | Role-appropriate actions (filing, overrides, assignment) | `refuses role-inappropriate filing, statutory overrides and assignments` | pass |
| 13 | Append-only status history | `keeps compliance status history append-only` | pass |
| 14 | Server-side scoping + pagination | `scopes article queries to their own desk and paginates` | pass |
| 15 | Job enqueue idempotency (cron twice) | `enqueues the daily recurrence job idempotently` | pass |
| 16 | Migration report + backfilled period fields | `has a migration report and period fields on legacy-created work` | pass |
| 17 | Edge role policy (generation manager+) | `tests/auth-policy.test.ts` (3 tests) | pass |

Prompt 4 suites (onboarding, client-migration) re-run green alongside these, confirming
activation idempotency, invoice/payment preservation and WhatsApp-send prevention still
hold after the Prompt 5 changes.

## HTTP verification (production build, `next start`)

| Check | Expected | Actual |
|---|---|---|
| `POST /api/auth/login` (partner) | 200 | 200 |
| `GET /api/engagements?page=1&per_page=3` | 200, paginated items with period/FY/stage | 200 |
| `POST /api/engagements/preview` | 200 plan (`create`/`exists`/`skip`/`invalid` + warnings) | 200 |
| `POST /api/engagements/generate` without `confirmed` | 400 | 400 |
| `POST /api/engagements/generate` #1 | 201, `created: 3` of 31 | 201, created 3 |
| `POST /api/engagements/generate` #2 (same window) | 201, `created: 0` | 201, created 0, `exists: 8` |
| `POST …/generate` as article | 403 | 403 (`Your role (article) cannot perform this action`) |
| `GET /api/engagements` unauthenticated | 401 | 401 |
| `GET /api/cron/recurrence` no secret | 401 with `CRON_SECRET` guidance | 401 |
| `GET /api/cron/recurrence` with `Bearer $CRON_SECRET` | 200, sweep runs | 200, `created: 3`, `job_id: JOB-001` |
| second cron call same day | `queued: false`, same job id | 200, `queued: false`, `JOB-001` |
| `GET /api/engagements/runs` | run history with counts | 200, GEN-001/GEN-002 listed |
| `GET /api/due-date-rules` | rules, all `verification_status: unverified` | 200 |
| `/compliance`, `/workflow` pages | 200 with session | 200 |

Cross-firm isolation: this installation is single-firm (no `firm_id`); the equivalent
guarantee tested here is **desk/role scoping** — an article assistant's list query is
scoped server-side and generation/override endpoints refuse them, verified by test and
over HTTP.

## Not covered / blocked

- Concurrent multi-process generation is exercised through the DB unique index and
  transaction-level guards rather than a true parallel-process test (single SQLite
  writer).
- No government integration exists, so `filing_confirmed_by_integration = 1` has no
  path to occur; its permanent-0 behaviour is asserted instead.
- Real Vercel Cron delivery (header/UA) cannot be exercised locally; the secret path
  and the rejection path are both verified over HTTP.