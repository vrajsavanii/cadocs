# Executive Audit Report — NexAgent (Verification V1)

Date: 2026-10-27 · Repository: `master` @ `4728172` · Scope: repository audit, feature inventory,
workflow mapping, safe baseline testing, and test planning only (RULE 12 — no remediation).

---

## 1. What was inspected

- Full repository map: 77 API routes, 17 pages, 20 view components, 36 `lib/` modules
  (~19.5k LOC), 44 SQLite tables, 14 test files, docs tree (44 documents), scripts, `vercel.json`.
- Authentication/edge layer (`proxy.ts`, `lib/auth.ts`, `lib/crypto.ts`), database schema and
  migration backfill, storage layer, backup tooling, deployment configuration.
- Every module listed in FEATURE-INVENTORY (F-01…F-106), traced from UI entry → API → logic →
  DB → background/external events → UI state.
- Live environments: LOCAL-BUILD smoke suite and read-only probes of PROD-DEMO.

## 2. Modules and workflows verified

- **Verified with evidence:** auth/session/RBAC gate (incl. live role probes), client onboarding
  with multi-GST registrations, engagement generation idempotency & due-date rules, document
  management & storage, assignment/workflow transitions with filing evidence, invoicing →
  approval → issue → payments → credit notes → PDF tokens, reporting + CSV export parity,
  backup tooling, persistence, dashboard KPIs.
- **Partially verified:** cron scheduling (auth broken — DEF-001), automation sweeps (ran live,
  untested failure paths), WhatsApp queue mode (cloud send blocked, callbacks missing),
  recovery drill (tooling tested, drill not run).
- **Not verified at all:** AI Copilot behavior, timesheets, campaigns, notices, proposals,
  DSC, UDIN, all UI interaction beyond page rendering.
- **Not implemented:** payment gateway, WhatsApp status webhooks, multi-firm tenancy, SaaS
  plans/entitlements/subscription billing (Prompts 14–15), dedicated ITR/tax-audit modules,
  firm invitations.

## 3. Checks actually executed (see BASELINE-TEST-RESULTS.md for outputs)

1. `npx tsc --noEmit` → **exit 0**
2. `npx vitest run` → **109/109 tests pass**, 13 files, 0 failures, 27.4 s
3. `npm run build` → **exit 0**
4. Built-app HTTP smoke: 40 unauthenticated/authenticated/RBAC/injection/traversal probes
5. `npx vercel env ls` (read-only) and live PROD-DEMO probes (health, site, cron repro)

## 4. Actual test results and failures

- Zero test failures. Zero type errors. Build clean.
- **Failures found by probes, not by the suite:** cron spoofing succeeded locally **and** in
  production (DEF-001); production instance cold-starts observed (DEF-002); anonymous health
  discloses firm/stack/version (DEF-003).

## 5. Confirmed broken or disconnected features

| ID | Severity | Summary |
|---|---|---|
| DEF-001 | **P1** | Cron endpoints execute sweeps for any caller via spoofable `x-vercel-cron` header because `CRON_SECRET` is unset anywhere; reproduced live on production (recurrence job created 3 engagements unauthenticated) |
| DEF-002 | **P1** | Production runs on ephemeral `/tmp` storage (`CA_ALLOW_EPHEMERAL=1`) — data loss on every cold start, per-instance divergence |
| DEF-004 | P2 | WhatsApp provider status webhooks missing — messages never reach Delivered/Read/Failed-from-provider |
| DEF-003 | P3 | Anonymous health endpoint discloses tenant identity and stack (contradicts own documentation) |
| DEF-005 | P3 | No linter (`lint` = `tsc`) and no CI pipeline |
| DEF-006 | P3 | Plaintext bootstrap password file persists on dev machines |

No P0: no cross-tenant exposure path (single-firm architecture), no unauthorized financial
mutation found, no unrecoverable data-loss bug in code (DEF-002 is configuration-driven).

## 6. Missing functionality

Payment gateway, WhatsApp webhook processing, multi-tenancy/firm provisioning, SaaS
subscriptions & entitlements (prompts 14–15), invitation flows, dedicated ITR/tax-audit
workflow modules, real linter/CI, any browser/E2E test framework, API-level test harness.

## 7. Security and data-integrity strengths observed

Central edge gate with per-request role policy, CSRF origin blocking, per-user write rate
limits, login brute-force limiter, `token_version` session revocation, append-only compliance
history enforced by SQLite triggers, idempotent generation, invoice numbers allocated in a
finalisation transaction, payment ledger immutability (reversals only), private PDF storage
with expiring single-invoice tokens, encrypted PAN/GSTIN columns, path-traversal-safe storage
keys, parameterised SQL (injection probe returned empty results), opt-in gating for WhatsApp,
AI write-approval re-validating ownership/role/schema/domain on approval.

**Risks:** cron auth (DEF-001), ephemeral production storage (DEF-002), untested AI approval
gate, no automated UI/API coverage, single-writer SQLite ceiling unquantified, article-role
read scope worth a product decision (OBS-04).

## 8. Features blocked by credentials or infrastructure

WhatsApp Cloud API (no token/phone/template anywhere) · AI cloud providers on Vercel (no keys
locally except `.env.local`) · R2 storage (no credentials) · Vercel Cron (no `CRON_SECRET`) ·
persistent production storage (no volume).

## 9. Test-environment requirements

Stand up LOCAL-DISPOSABLE (temp `CA_DATA_DIR` + seed), synthetic data generator, API-level test
harness, browser harness, mock WhatsApp/AI providers, failure-injection utilities — detailed in
ENVIRONMENT-AND-TEST-DATA-PLAN.md §3. Today **no environment supports destructive or mass tests**.

## 10. Prioritized remediation sequence

1. **DEF-001 cron auth** (unauthenticated mutation path, live-reproducible)
2. **DEF-002 storage durability** (before any real data touches the deployment)
3. CI + linter (DEF-005) so fixes stay fixed
4. Health disclosure + bootstrap file (DEF-003, DEF-006)
5. V3 AI Copilot test coverage (largest untested high-risk module)
6. V4 integration contracts (WhatsApp webhooks, invoice-generation idempotency, report/export parity)
7. V5 UI/E2E journeys → V6 scale/recovery → V7 commercial features (implemented first, then verified)

## 11. First critical defect / workflow to address

**DEF-001 — cron authorization.** It is the only finding that lets an unauthenticated internet
caller mutate application state on a live deployment today, it reproduced on production during
this audit, and its fix (require `CRON_SECRET`, delete the header fallback, add a route test) is
small and immediately regression-testable. DEF-002 is the equally urgent prerequisite before any
real firm's data can be accepted by the deployment.

---

### Fact / hypothesis / assumption discipline

- **Facts:** everything in §§1–5 with commands, status codes, and file references in the
  companion documents.
- **Hypotheses (untested):** OBS-01…OBS-08 in DEFECT-REGISTER — UI behaviors, AI gate runtime
  behavior, invoice-generation idempotency, concurrency ceiling.
- **Assumptions deliberately not made:** no claim of production readiness, no claim that any
  workflow beyond those listed in §2 works, no scale/performance claim of any kind, no
  "verified working" status granted for the mere existence of a screen or route.

**V1 is complete. No remediation was started. NexAgent is not ready for sale.**