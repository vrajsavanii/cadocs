# Test Baseline — NexAgent / CADocs (24 Oct 2026)

## Environment

- Machine: local Windows checkout ([npm] scripts, Node v25.6.0).
- Isolation: none needed below except that typecheck/build are read-only; no migration or seed action was executed.
- Network: live deployment https://cadocs-ca.vercel.app used for read-only HTTP checks only.

## Executed checks

| # | Command/check | Executed? | Result | Evidence |
|---|---|---|---|---|
| 1 | `npm run typecheck` (`tsc --noEmit`) | ✅ | **pass**, exit 0 | console output, no diagnostics |
| 2 | `npm run build` (`next build` → log `/tmp/audit-build.log`) | ✅ | **pass**, exit 0; "Compiled successfully in 25.9s", 2/2 static pages | log grep |
| 3 | Existing test suite | ✅ (attempted inventory) | **none exists** — no `tests/`, no `test`/`vitest`/`jest`/playwright in package.json | filesystem + package.json read |
| 4 | Route surface inventory | ✅ | 57 route files enumerated under `app/api/**/route.ts` | glob |
| 5 | Schema inventory | ✅ | 21 tables via `CREATE TABLE` search of `lib/db.ts`; migrations: none (ad-hoc boot `ALTER`s) | code search |
| 6 | Production-deploy HTTP baseline | ✅ | `GET /api/health` → **HTTP 500** on the deployed instance at the time of check (pre-config; not diagnosed further as this is audit-scope of the *code*, not the host env). `/site`, `/privacy`, `/login` → 200; protected routes → 307; APIs → 401 | curl matrix (read-only) |
| 7 | Auth route live matrix (unauth positive/negative cases) | ✅ | 200 for public paths; 307 for app pages; 401 JSON for API under `/api` | curl matrix |
| 8 | Unit/behaviour tests of reminder cap, billing idempotency, per-request statuses | ❌ not executed | **not feasible in audit mode** — would require writing fixtures into the DB; documented as a P1 gate via new `vitest` suite | — |
| 9 | WhatsApp Cloud send (live provider call) | ❌ blocked | requires `WHATSAPP_TOKEN`/`PHONE_ID`/approved template — not configured; code path inspected only | — |
| 10 | Real AI provider tool-calling path | ❌ blocked | requires an API key in env; deterministic fallback is code-inspected | — |

## Existing failures / blockers recorded

| Blocker | Detail | Recommended resolution |
|---|---|---|
| No test harness | Zero automated tests; every claim in this audit is code-inspection-based. Highest-leverage change before ANY feature work. | P1: introduce `vitest`, a temp-`CA_DATA_DIR` fixture, and the plan's 15 acceptance scenarios as cases |
| No migrations runner | Schema changes ship as ad-hoc `ALTER`s at boot; two environments can drift silently | P1 migrations ledger |
| No clean-state harness for concurrent-instance checks | rate-limits and locks are in-memory per-process; can't be shown cross-instance on SQLite alone | P1 Postgres or shared-disk backend |
| No delivery/inbound-webhook test target | no currently deployed webhook URL registered with Meta | P3 WhatsApp work |
| `/api/health` 500 on live demo | likely `/tmp` write/env drift on the demo host — **not a code defect found in repo**; flagged separately. Do not fix as part of this audit unilaterally without the host's agreement. | Post-P1 recheck against new backend |

## Untested areas (explicit)

Behaviour of: rejection→re-open of document requests; deadline overrides; concurrent sweep double-execution; password rotation invalidating in-flight sessions (spec-backed but not exercised); large/partial-dataset report outputs; non-Latin uploads/files; zip polyglot paths; export under all three roles before/after S1 fix.

## Verification approach used for behavioural claims

Where a behaviour could not be exercised safely, the audit required either (a) direct code-path tracing with line-level refs in the relevant doc, or (b) feature-matrix marking `NOT_VERIFIED` instead of claiming a pass. No fabricated results appear in [FEATURE-MATRIX.md](FEATURE-MATRIX.md).
