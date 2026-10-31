# Baseline Test Results — NexAgent (Verification V1)

All commands executed 2026-10-27 from the repository root on the developer machine
(Windows, Node ≥ 24, git branch `master`, commit `4728172`, clean working tree before this
documentation change). Exit codes below are the **actual** captured values.

## 1. Commands executed

| # | Command | Purpose | Exit / result |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | static type check (`npm run lint` is this same command) | **exit 0**, no diagnostics |
| 2 | `npx vitest run` | full test suite | **exit 0** — 13/13 files, **109/109 tests passed**, 0 failed, 27.4 s |
| 3 | `npm run build` | production build (Next.js 16) | **exit 0**, all 17 pages + 77 API routes compiled, middleware ("Proxy") registered |
| 4 | `npm start` (built app) + HTTP smoke probes | runtime verification of auth, RBAC, pages, APIs | see §3 |
| 5 | `npx vercel env ls` | configuration audit (read-only) | env names listed; **no `CRON_SECRET`** present |
| 6 | Live probes of `https://cadocs-ca.vercel.app` (read-only + cron probes) | production behavior | see §4 |

**Not run (and why):** no linter exists beyond `tsc` (DEF-005); no browser/E2E framework is
installed (OBS-01); no dedicated API test harness exists; no performance/concurrency suites
exist (all planned in TEST-SCALE-MATRIX.md).

## 2. Unit / integration suite detail (`npx vitest run`)

| Test file | Tests | Result |
|---|---|---|
| `tests/auth-policy.test.ts` | 3 | ✅ pass |
| `tests/backup.test.ts` | 2 | ✅ pass |
| `tests/billing.test.ts` | 18 | ✅ pass |
| `tests/client-migration.test.ts` | 2 | ✅ pass |
| `tests/config.test.ts` | 6 | ✅ pass |
| `tests/documents.test.ts` | 7 | ✅ pass |
| `tests/jobs.test.ts` | 5 | ✅ pass |
| `tests/onboarding.test.ts` | 14 | ✅ pass |
| `tests/persistence.test.ts` | 3 | ✅ pass |
| `tests/recurrence.test.ts` | 16 | ✅ pass |
| `tests/reports.test.ts` | 12 | ✅ pass |
| `tests/staff-workflow.test.ts` | 19 | ✅ pass |
| `tests/storage.test.ts` | 4 | ✅ pass |
| **Total** | **109** | **0 failures** |

No tests were skipped, weakened, or modified for this baseline. `ExperimentalWarning: SQLite`
messages are runtime notices from `node:sqlite`, not failures.

## 3. HTTP smoke probes (LOCAL-BUILD, `next start`, port 58744)

Unauthenticated:

| Probe | Expected | Actual |
|---|---|---|
| `GET /` | redirect to public site | **307** ✅ |
| `GET /site` | 200 | **200** ✅ |
| `GET /login` | 200 | **200** ✅ |
| `GET /reports` (no session) | redirect to login | **307** ✅ |
| `GET /api/health` | 200 | **200** (but leaks firm/stack → DEF-003) ⚠️ |
| `GET /api/dashboard`, `/api/clients`, `/api/export`, `/api/invoices/[id]/pdf`, `POST /api/ai/chat` | 401 | **401** ✅ |
| `POST /api/clients` with foreign `Origin` | rejected | 401 (auth precedes CSRF) ✅ |
| `POST /api/auth/login` with wrong credentials | 401 | **401** ✅ |
| `GET /api/cron/automation` (no secret, no header) | 401 | **401** ✅ but see next row |
| `GET /api/cron/automation` with spoofed `x-vercel-cron: 1` | 401 | **200 — DEF-001** ❌ |

Authenticated as partner (`admin`):

| Probe | Actual |
|---|---|
| `POST /api/auth/login` | 200 + session cookie set ✅ |
| `GET /api/dashboard` | 200 with real KPIs (12 active clients, 31 overdue, ₹553,420 billed, ₹253,700 collected) ✅ |
| `GET /api/clients`, `/api/reports`, `/api/engagements`, `/api/invoices`, `/api/documents`, `/api/workflow`, `/api/ai/usage`, `/api/search?q=sh` | all **200** ✅ |
| All 17 pages (`/clients` … `/agent`) | all **200** ✅ |
| `GET /api/export?type=invoices` | 200, 1,530-byte CSV with correct rows (INV-2026-012 ₹28,320 Pending) ✅ |
| `GET /api/export?type=DROP TABLE` | **400** ✅ |
| `GET /api/search?q=' OR 1=1--` | 200, empty result groups (parameterised, no injection) ✅ |
| `GET /api/documents/../../../etc/passwd/file` (`--path-as-is`) | **404** ✅ |

Authenticated as article (`staff`):

| Probe | Expected | Actual |
|---|---|---|
| `GET /api/users` | 403 | **403** ✅ |
| `POST /api/invoices`, `/api/settings`, `/api/users`, `/api/payments` | 403 | all **403** ✅ |
| `GET /api/invoices`, `/api/dashboard` | 200 (reads open to all roles by design) | **200** — see OBS-04 |

## 4. Production probes (PROD-DEMO, `https://cadocs-ca.vercel.app`)

| Probe | Result |
|---|---|
| `GET /api/health` | 200; instance uptime observed at **3 s** and later **70 s** → frequent cold starts (evidence for DEF-002) |
| `GET /site` | 200 ✅ |
| Cron spoof probe (`x-vercel-cron: 1`) on `/api/cron/automation` | **200** — sweep executed (0 rules enabled; client engine considered 39 requests, cleared 2) |
| Cron spoof probe on `/api/cron/recurrence` | **200** — job ran, **created 3 engagements**, skipped 34 (idempotent engine held; no duplicates) |

⚠️ These two cron probes **mutated the PROD-DEMO database** (a documented synthetic demo
environment with ephemeral storage and no WhatsApp credentials configured). They are the
reproduction evidence for DEF-001. No customer data exists there by design.

## 5. Static inspection results

| Check | Result |
|---|---|
| `TODO / FIXME / "coming soon" / "not implemented"` markers in `app/ components/ lib/` | **0 real hits** (only CSS `placeholder:` classes) |
| `console.log` in `lib/` + `app/` | **0** |
| Empty catch blocks (`catch {}`) | **0 found** |
| No-op handlers (`onClick={() => {}}`), `window.alert`, `confirm(` in views | **0** |
| Dead/placeholder UI buttons by static inspection | none found (behavioral verification still pending → OBS-01) |
| Secret leakage into git | `.env*`, `.data/`, `deploy-credentials.local.md`, `.backups/` all ignored (`git check-ignore` verified); `git status` clean |

## 6. Baseline verdict

- **Green:** typecheck, full unit/integration suite (109/109), production build, authenticated
  page/API smoke, RBAC enforcement, injection/traversal probes.
- **Red:** cron authorization (DEF-001, confirmed live), production storage persistence
  (DEF-002, confirmed live), health disclosure (DEF-003), WhatsApp status callbacks missing
  (DEF-004).
- **Unverified:** all UI behavior beyond rendering, AI layer behavior, timesheets/campaigns/
  notices/proposals/DSC/UDIN flows, any performance or concurrency claim.

**This baseline was not achieved by modifying tests, skipping cases, or suppressing errors.**
No application code or test code was changed during V1.