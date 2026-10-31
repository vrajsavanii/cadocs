# Verification Roadmap — NexAgent (Verification Programme)

V1 is complete: audit, baseline, workflow mapping and planning only (RULE 12 — no remediation
was performed). This roadmap sequences the remaining stages. Each stage must end with a results
file recording **actual** executed commands and outcomes.

## Stage ordering principle

Fix security/integrity defects that can mutate data unauthenticated **before** expanding test
coverage, then close the highest-risk coverage holes (AI gate, API-level tests), then UI/E2E,
then scale/recovery, then commercial-readiness (subscriptions, tenancy) verification.

---

## V2 — Security & infrastructure remediation verification (first critical item: DEF-001)

| Priority | Item | Exit criteria |
|---|---|---|
| 1 | Fix DEF-001 (cron auth): require `CRON_SECRET`, drop spoofable header fallback; set the secret on Vercel | route test: 401 without/with wrong secret, 200 only with Bearer; public probe returns 401 |
| 2 | Fix DEF-002 for any real-data use: persistent volume or R2 storage, remove `CA_ALLOW_EPHEMERAL` | `/api/health` storage indicator shows durable mode; cold-start data survives; documented single-writer topology respected |
| 3 | Fix DEF-003 (health disclosure) + DEF-006 (bootstrap password file lifecycle) | anonymous health payload = booleans only; password file removed on first change |
| 4 | Regression suite for the above + API-level auth tests (login/CSRF/rate-limit over HTTP) | new tests green in CI |
| 5 | Add CI pipeline + real linter (DEF-005) | every push runs typecheck + tests + build |

**Deliverable:** `docs/verification/V2-RESULTS.md`.

## V3 — AI Copilot verification (Workflow K) — highest-risk untested module

- Unauthorized read attempt, unapproved write attempt, approval-gate re-validation, quota
  exhaustion, role matrix across all registered tools, keyless fallback determinism.
- Tests must run with provider keys unset (deterministic mode) plus one optional live-provider
  smoke with a low-quota key.
- Exit: every tool in `lib/ai-tools.ts` classified per role; approval gate covered by automated
  tests; any defect filed in DEFECT-REGISTER.

## V4 — Integration contract tests

- WhatsApp: mock Graph API + signed webhook callbacks (this closes DEF-004 implementation and
  verifies it); delivery receipts never imply payment.
- Recurring invoice generation idempotency (OBS-03): retried generation → zero duplicates.
- Public demo-request lead persistence trace (OBS-05).
- Reports ↔ export HTTP parity with identical filters (OBS-06).
- Exit: INTEGRATION-DEPENDENCY-MATRIX rows I-05, I-12, I-23 move to Connected with evidence.

## V5 — UI/E2E verification of core journeys

- Add a browser harness; automate Workflows B, C, E, F, H end to end with role variants
  (partner/manager/article), loading and failure states, duplicate-click safety, responsive
  checks (desktop/tablet/mobile widths).
- Control-by-control audit per RULE 8 feeding FEATURE-INVENTORY status upgrades.
- Exit: five journeys green; OBS-01 resolved or concretely scoped.

## V6 — Scale, concurrency, recovery (TEST-SCALE-MATRIX)

- Stand up LOCAL-DISPOSABLE harness + synthetic data generator (ENVIRONMENT plan §3).
- Execute S-2..S-4 → M-1..M-5 → L-1..L-7; record durations, sizes, failure rates.
- Full Workflow O restore drill: backup → restore into disposable env → smoke suite.
- Exit: scale results recorded; SQLite single-writer ceiling either quantified or Postgres
  migration declared a launch blocker.

## V7 — Commercial-readiness verification (Prompts 14–15 scope, currently Not Implemented)

- Only after product decisions: firm provisioning, memberships/invitations, plans & entitlements,
  quota enforcement, subscription billing with verified provider events, platform-admin
  isolation, customer lifecycle (export/retention/deletion).
- Do **not** invent prices, trial terms, or legal text; verify only what gets implemented.
- Exit: entitlement enforcement proven server-side; marketing claims matched to verified facts.

## Standing rules for all later stages

1. Every defect confirmed with reproduction evidence before severity assignment.
2. No test weakened/skipped to get green; failures documented, not hidden.
3. Destructive/mass tests only in LOCAL-DISPOSABLE; PROD-DEMO read-only.
4. No real WhatsApp sends, no real payments, no real customer data in any test.
5. Stage results appended to `docs/verification/` — V1 files stay, they are the baseline.