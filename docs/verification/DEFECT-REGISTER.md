# Defect Register — NexAgent (Verification V1)

Severities per RULE 10. Only defects with reproduction evidence are marked **Confirmed**;
suspicions are listed separately as **Observations / Untested hypotheses** and must not be
treated as defects until V2 evidence exists.

Environment abbreviations: **LOCAL-DEV** (shared developer database `.data/ca-suite.db`),
**LOCAL-BUILD** (`next start` from the committed production build), **PROD-DEMO**
(`https://cadocs-ca.vercel.app`, ephemeral storage demo deployment).

---

## DEF-001 — Cron sweep endpoints accept a spoofable header when `CRON_SECRET` is unset — **P1 (High)** — Confirmed

- **Module:** Automation / scheduling (`app/api/cron/automation`, `app/api/cron/recurrence`)
- **Environment:** LOCAL-BUILD and PROD-DEMO (both lack `CRON_SECRET`)
- **Preconditions:** `CRON_SECRET` not configured (verified: absent from `.env`, `.env.local`,
  and `npx vercel env ls` for both Preview and Production).
- **Reproduction:**
  1. `curl -H "x-vercel-cron: 1" https://cadocs-ca.vercel.app/api/cron/automation`
  2. `curl -H "x-vercel-cron: 1" https://cadocs-ca.vercel.app/api/cron/recurrence`
- **Expected result:** 401 Unauthorized without a configured secret.
- **Actual result:** both returned **200 `{"ok":true,...}`**. The recurrence sweep
  **created 3 new compliance engagements on production** (`created:3, skipped:34`) and enqueued a
  job; the automation sweep ran the client document-request engine (39 requests considered,
  2 cleared). Locally, an identical unauthenticated probe executed 9 enabled rules with
  114 actions taken.
- **Evidence:** curl outputs captured in the V1 session (this run, 2026-10-27); `lib` source:
  `authorize()` in `app/api/cron/*/route.ts` returns `isVercelCron(req)` when `secret` is empty,
  and `isVercelCron` trusts `x-vercel-cron` / `user-agent` — both trivially settable by any caller.
- **Likely root cause:** authorization designed around "Vercel sets this header" without requiring
  the secret to exist; header trust not tied to platform network identity.
- **Customer impact:** any internet caller can force background sweeps at will: create engagements
  early, drive automation actions, and — once `WHATSAPP_TOKEN` is configured — trigger real
  customer WhatsApp template sends attributed to the partner. Would rise to **P0** in a deployment
  with payment-triggering or irreversible actions enabled.
- **Recommended fix:** refuse to serve cron routes unless `CRON_SECRET` is set and matches
  (Bearer or `key`); remove the header/UA fallback or restrict it to Vercel's internal IPs;
  emit a boot-time warning when cron endpoints exist without a secret.
- **Regression test required:** route-level test asserting 401 with no secret, 401 on wrong
  secret, 200 only with correct Bearer; header-only request must never execute work.
- **Status:** Open — confirmed, not fixed (V1 = no remediation per RULE 12).

## DEF-002 — Production deployment runs on ephemeral storage (data loss on cold start) — **P1 (High)** — Confirmed

- **Module:** Infrastructure / persistence (`lib/config.ts` boot guard, Vercel environment)
- **Environment:** PROD-DEMO
- **Preconditions:** `CA_DATA_DIR=/tmp/...` on Vercel with `CA_ALLOW_EPHEMERAL=1` set
  (verified via `npx vercel env ls`).
- **Reproduction:** `curl https://cadocs-ca.vercel.app/api/health` repeatedly — instance uptime
  observed at 3 s and 70 s within minutes, proving cold starts; each cold start re-initialises an
  empty database in `/tmp`.
- **Expected result:** a production system selling to CA firms persists clients, invoices and
  documents across restarts and serves all instances from one store.
- **Actual result:** every cold start discards data; separate serverless instances cannot share
  the file, so concurrent instances would diverge (split-brain).
- **Evidence:** Vercel env listing (2026-10-27); `docs/operations/PRODUCTION-ENVIRONMENT.md`
  documents `demo-ephemeral` semantics; uptime observations above.
- **Customer impact:** any real firm using the deployed site would silently lose client,
  invoice and document data. Deployment is safe **only** as a demo/evaluation environment.
- **Recommended fix:** mount a persistent volume (or move to R2-backed storage) with
  `CA_STORAGE_PROVIDER=r2`, set a real `CA_DATA_DIR`, then remove `CA_ALLOW_EPHEMERAL`.
  Single-writer topology must be respected (SQLite single-process boundary — consider the
  documented Postgres migration point before multi-instance hosting).
- **Regression test required:** boot-guard test already exists (`config.test.ts`); add a deploy
  checklist item asserting `storage_config != demo-ephemeral` before any real customer data.
- **Status:** Open — accepted as demo mode by operator decision; must be resolved before any
  paying customer (launch blocker).

## DEF-003 — Unauthenticated health endpoint discloses firm name, product version and stack — **P3 (Low)** — Confirmed

- **Module:** `app/api/health/route.ts`
- **Environment:** all
- **Reproduction:** `curl https://cadocs-ca.vercel.app/api/health` (no session).
- **Actual result:** returns `firm: "Sharma & Associates"`, `version: "3.0.0"`,
  `stack: "Next.js 16 · React 19 · SQLite"` to anonymous callers.
- **Expected result:** anonymous health checks return status booleans only (the doc
  `PRODUCTION-ENVIRONMENT.md` itself states "unauthenticated … reports booleans only" — the
  implementation does not match its own documentation).
- **Customer impact:** fingerprinting aid; leaks tenant identity of whichever firm is deployed.
- **Recommended fix:** gate firm/stack/version fields behind authentication or a `HEALTH_DETAIL`
  flag; keep anonymous payload to `{"status":"ok"}`.
- **Regression test required:** anonymous health response contains no firm/stack/version keys.
- **Status:** Open.

## DEF-004 — WhatsApp provider status callbacks are not implemented (delivery statuses never update) — **P2 (Medium)** — Confirmed

- **Module:** WhatsApp integration (`lib/whatsapp.ts`, missing webhook route)
- **Environment:** all (latent until `WHATSAPP_TOKEN` is configured; then immediately visible)
- **Reproduction:** `grep -rln webhook app/` → no route; `markMessageStatus` is called only from
  the synchronous send response in `lib/whatsapp.ts`. No `/api/webhooks/whatsapp` (or similar)
  endpoint exists.
- **Expected result:** Meta Graph status webhooks (sent/delivered/read/failed) update
  `messages.status`, feeding failed-message retries and reminder decisions.
- **Actual result:** statuses stop at `Sent` or `Failed` from the API response; `Delivered`,
  `Read` are unreachable. Workflow G's "process message statuses" step cannot execute.
- **Customer impact:** firms cannot tell whether clients actually received requests; reminder
  logic cannot distinguish undelivered messages. Money-collection via invoice WhatsApp delivery
  would run blind.
- **Recommended fix:** add an authenticated webhook route (signature verification with app
  secret), map `statuses` callbacks to `messages`, add retry for transient failures.
- **Regression test required:** mock provider callback tests: valid signature accepted, invalid
  signature 401, out-of-order/duplicate callbacks idempotent.
- **Status:** Open.

## DEF-005 — No linter and no CI pipeline — **P3 (Low)** — Confirmed

- **Module:** tooling / process
- **Reproduction:** `package.json` → `"lint": "tsc --noEmit"` (typecheck only, no ESLint/
  Prettier); `.github/` does not exist → no automated pipeline runs tests on push.
- **Actual result:** style and whole classes of static issues are unchecked; the 109-test suite
  and typecheck only run when someone executes them manually.
- **Customer impact:** regression risk grows with every commit; quality gate depends on
  discipline rather than enforcement.
- **Recommended fix:** add ESLint with the Next.js config; add a CI workflow running
  `typecheck + vitest + next build` on every push/PR.
- **Status:** Open.

## DEF-006 — Plaintext bootstrap password file persists after use — **P3 (Low)** — Confirmed (dev machines only)

- **Module:** auth seeding (`lib/db.ts#seedUsersIfEmpty`)
- **Environment:** LOCAL-DEV only (production receives `ADMIN_PASSWORD`/`MANAGER_PASSWORD`/
  `STAFF_PASSWORD` from Vercel env, so no file is written there).
- **Reproduction:** `.data/bootstrap-credentials.txt` readable on disk containing the three
  seeded account passwords in plaintext (mode 0600, correctly git-ignored — `git check-ignore`
  confirmed).
- **Expected result:** file deleted/rotated once passwords are changed in Settings.
- **Actual result:** stale plaintext credentials remain indefinitely, and the file's own header
  says "delete this file after storing the passwords".
- **Customer impact:** local-only credential exposure if a dev machine is shared or the file is
  pasted into a ticket (it was, historically — that is how this audit masked it).
- **Recommended fix:** delete the file on first successful password change; warn in Settings
  while it exists.
- **Status:** Open.

---

## Observations / untested hypotheses (NOT defects yet)

| ID | Observation | Why not a defect yet | Verification planned |
|---|---|---|---|
| OBS-01 | UI controls (buttons, forms, dialogs, uploads, approve/reject, exports) have **no automated UI/E2E coverage**; only static inspection found no dead handlers (`TODO`/no-op `onClick`/`alert(` all absent) | Static absence of placeholders is not proof of correct behavior | V2: browser harness over the five core journeys (B, C, E, F, H) |
| OBS-02 | AI approval gate (`F-71`) has zero tests | Code reading shows all gates re-run, but no execution evidence | V2: unauthorized read + unapproved write probes (Workflow K) |
| OBS-03 | `POST /api/invoices/generate` recurring-generation idempotency not directly tested | Indirect coverage only; duplicate-invoice risk is business-critical | V2: retried generation must create zero duplicates |
| OBS-04 | Article role can read invoices/clients (`canAccess` allows all reads) | Documented design ("read-only") — but data-exposure expectations for article staff should be confirmed with stakeholders | V2: confirm with product owner; add scope restriction if needed |
| OBS-05 | Public demo-request endpoint lead storage unclear (leads tables removed from schema) | May intentionally store elsewhere; route responds correctly | V2: trace persistence target |
| OBS-06 | Reports ↔ export parity asserted in unit tests but not with identical live HTTP filter round-trips | Unit evidence exists | V2: HTTP-level parity check (Workflow L) |
| OBS-07 | Restore drill (Workflow O) not executed end-to-end in a disposable environment | Backup + verification tooling unit-tested and a real backup exists | V2: full restore drill with smoke tests |
| OBS-08 | Concurrency behavior of SQLite under parallel sessions untested (`database is locked` risk) | Topology documented as single-writer; no evidence of failure | V2: TEST-SCALE-MATRIX L-3 |

## Severity summary

| Severity | Count | IDs |
|---|---|---|
| P0 — Critical | 0 | — |
| P1 — High | 2 | DEF-001, DEF-002 |
| P2 — Medium | 1 | DEF-004 |
| P3 — Low | 3 | DEF-003, DEF-005, DEF-006 |

**No cross-tenant data exposure, no unauthorized financial mutation, and no unrecoverable data
loss path was found in the audited code** — the two P1s are an unauthenticated background-job
trigger and a deployment-configuration data-loss risk, respectively.