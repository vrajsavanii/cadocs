# Test Coverage Matrix — NexAgent (Verification V1)

Legend:

- ✅ exists **and executed green** in the V1 baseline (`npx vitest run` → 13 files, 109 tests, 0 failures)
- ⚠️ exists but only exercises part of the feature
- ❌ missing
- Columns: Unit = pure/service-layer logic · Int = service layer against a real temp SQLite DB ·
  API = HTTP route handler invoked over the wire · UI = component-level interaction ·
  E2E = full browser journey · Sec = security boundary · Conc = concurrency · Perf = load/volume ·
  Rec = recovery/restore

Baseline reality: the project's harness is **vitest against real SQLite temp databases**.
There is no browser/E2E framework installed (package.json has no playwright/cypress), and no
HTTP-level test harness — API coverage below is achieved indirectly where tests call the same
service functions the routes call, plus the V1 smoke probes (recorded in BASELINE-TEST-RESULTS.md).

| Feature / workflow | Unit | Int | API | UI | E2E | Sec | Conc | Perf | Rec | Test file(s) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01..03 auth, session, edge policy | ✅ | — | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `auth-policy.test.ts` (3) |
| F-05/F-16 role policy & isolation | ✅ | ✅ | ⚠️ smoke (staff 403s) | ❌ | ❌ | ✅ | ❌ | ❌ | — | `auth-policy`, `staff-workflow`, `onboarding` |
| F-06 field encryption, config guards | ✅ | ✅ | — | — | — | ✅ | — | — | — | `config.test.ts` (6), `storage.test.ts` (4) |
| F-10..15 clients, registrations, onboarding, services | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `onboarding.test.ts` (14), `client-migration.test.ts` (2) |
| F-20..22 engagement generation & due dates | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | — | ❌ | ❌ | — | `recurrence.test.ts` (16), `config.test.ts` |
| F-23 cron authorization | ⚠️ | — | ⚠️ smoke (401 w/o secret) | — | — | ❌ **defect found: DEF-001** | ❌ | ❌ | — | none for the header fallback |
| F-24/25 dashboard & deadline states | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ (role scoping) | ❌ | ❌ | — | `staff-workflow.test.ts` (19), `reports.test.ts` |
| F-26/27 workflow transitions, filing evidence, blockers | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `staff-workflow.test.ts` |
| F-30..32 documents, versions, review | ✅ | ✅ | ⚠️ smoke (traversal 404) | ❌ | ❌ | ✅ | ❌ | ❌ | — | `documents.test.ts` (7) |
| F-34/100 persistence & backup/restore | ✅ | ✅ | — | — | — | — | — | — | ⚠️ tooling verified, full drill not run | `persistence.test.ts` (3), `backup.test.ts` (2) |
| F-40/41 assignments & stage transitions | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `staff-workflow.test.ts` |
| F-42 timesheets, F-54 campaigns, F-55 notices, F-94..96 proposals/DSC/UDIN | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | none |
| F-50..53 WhatsApp queue, gating, reminder limits | ✅ | ✅ | — | ❌ | ❌ | ✅ (opt-in/eligibility) | ❌ | ❌ | — | via `billing.test.ts` delivery tests |
| F-52 provider status webhooks | ❌ | ❌ | ❌ | ❌ | ❌ | — | — | — | — | none (feature disconnected: DEF-004) |
| F-60..67 invoicing, payments, credit notes, PDF/tokens | ✅ | ✅ | ⚠️ smoke (401/403/400 probes) | ❌ | ❌ | ✅ | ❌ | ❌ | — | `billing.test.ts` (18) |
| F-69 recurring invoice generation | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | — | ❌ | ❌ | — | indirect only |
| F-70..73 AI chat, tools, approval gate, quota | ❌ | ❌ | ⚠️ smoke (401 unauth) | ❌ | ❌ | ❌ **gap** | ❌ | ❌ | — | none — largest coverage hole |
| F-80..82 reports, export, search | ✅ | ✅ | ⚠️ smoke (200/400, SQLi probe) | ❌ | ❌ | ✅ (scoping) | ❌ | ❌ | — | `reports.test.ts` (12) |
| F-90..93 job queue & automation runs | ✅ | ✅ | ⚠️ smoke (sweep ran) | ❌ | ❌ | ❌ (cron auth defect) | ❌ | ❌ | — | `jobs.test.ts` (5) |
| Workflow A (setup/roles) | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `auth-policy`, `staff-workflow` |
| Workflow B (onboarding) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — | `onboarding.test.ts` |
| Workflow C (GST lifecycle) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — | `staff-workflow`, `recurrence` |
| Workflow D (recurring) | ✅ | ✅ | ❌ | ❌ | ❌ | — | ❌ | ❌ | — | `recurrence.test.ts` |
| Workflow E (documents) | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `documents.test.ts` |
| Workflow F (approvals) | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | — | `staff-workflow.test.ts` |
| Workflow G (WhatsApp) | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ✅ (opt-in) | ❌ | ❌ | — | billing delivery tests only |
| Workflow H (invoice/payment) | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `billing.test.ts` |
| Workflow I/J (ITR/audit — generic path) | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | — | ❌ | ❌ | — | via recurrence tests |
| Workflow K (AI Copilot) | ❌ | ❌ | ⚠️ smoke | ❌ | ❌ | ❌ **gap** | ❌ | ❌ | — | none |
| Workflow L (reporting) | ✅ | ✅ | ⚠️ smoke | ❌ | ❌ | ✅ | ❌ | ❌ | — | `reports.test.ts` |
| Workflow M (automation/exceptions) | ⚠️ | ⚠️ | ⚠️ smoke | ❌ | ❌ | ❌ (DEF-001) | ❌ | ❌ | — | `jobs.test.ts` |
| Workflow N (subscriptions) | — | — | — | — | — | — | — | — | — | feature not implemented |
| Workflow O (recovery) | ✅ | ✅ | — | — | — | — | — | — | ⚠️ | `backup.test.ts` |

## Totals (V1 baseline)

| Dimension | Coverage |
|---|---|
| Unit + integration (vitest) | 109 tests green across 13 files |
| API/HTTP-level automated tests | **0** (covered only by manual V1 smoke probes) |
| UI / E2E automated tests | **0** — no browser framework installed |
| Security tests | embedded in service-layer tests (permissions, tokens, encryption, CSRF policy) + manual probes |
| Concurrency tests | **0** (job queue idempotency is asserted sequentially) |
| Performance / scale tests | **0** (see TEST-SCALE-MATRIX.md — all planned) |
| Recovery tests | backup + persistence unit-level only; full restore drill not run |

## Prioritized missing coverage (feeds VERIFICATION-ROADMAP.md)

1. **AI approval gate (F-71)** — write tools execute on approval; zero tests. Highest-risk gap.
2. **Cron authorization (F-92)** — confirmed defect DEF-001; needs regression test after fix.
3. **WhatsApp status callbacks (F-52)** — disconnected; needs webhook contract test with a mock provider.
4. **API-level tests** for login/session/CSRF/rate-limit over HTTP (currently manual probes only).
5. **UI/E2E** for the five core journeys (B, C, E, F, H) — requires adding a browser harness
   (allowed in V2, per RULE 12 not in V1).
6. **Timesheets, campaigns, notices, proposals, DSC, UDIN** — zero automated coverage.
7. **Concurrency + scale** per TEST-SCALE-MATRIX.md.