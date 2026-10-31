# Environment & Test-Data Plan — NexAgent (Verification V1)

## 1. Environment inventory (as found)

| Env | Identity | Database | Persistence | Real customer data? | External integrations | Eligible for testing? |
|---|---|---|---|---|---|---|
| LOCAL-DEV | developer machine, `next dev` / shared `.data/ca-suite.db` | SQLite 794 KB, seeded demo practice "Sharma & Associates" (12 clients, invoices, engagements) | local disk, persistent | **No** — synthetic seed only | none configured (no `WHATSAPP_TOKEN`; AI only via local `.env.local` keys) | ✅ for functional tests; ⚠️ shared — destructive tests should use a disposable `CA_DATA_DIR` instead |
| LOCAL-BUILD | `npm run build` + `npm start` on port 58744 | same `.data` DB | local disk | No | none | ✅ smoke/security probes (used in V1) |
| LOCAL-DISPOSABLE | *to be created*: `CA_DATA_DIR=/tmp/nexagent-test-<id>` with `CA_DEMO_SEED=1` | fresh SQLite per run | throwaway | No | mocked/absent | ✅ **designated home for destructive, scale and failure-injection tests (V2)** |
| UNIT-TEST DB | vitest temp DBs created per test file | fresh SQLite per file | auto-disposed | No | mocked | ✅ used by the 109-test suite |
| PROD-DEMO | `https://cadocs-ca.vercel.app` (Vercel) | SQLite in `/tmp` (`CA_ALLOW_EPHEMERAL=1`) | **ephemeral — wiped on cold start** | No — synthetic seed + `ADMIN/MANAGER/STAFF_PASSWORD` envs | none configured (no WhatsApp, no AI keys, no cron secret) | ⚠️ read-only probes OK; **never** for destructive tests; data mutations observed in V1 (DEF-001 repro) must not be repeated beyond reproduction needs |

**Verdict (RULE 3):** a genuinely safe environment for destructive/mass tests **does not yet
exist** — LOCAL-DISPOSABLE must be stood up first (§3). No environment holds real customer data
today; if that ever changes, PROD-DEMO becomes production and every rule in RULE 3 tightens.

## 2. Risk register for testing

| Risk | Where | Control |
|---|---|---|
| Real WhatsApp template sends to real phone numbers | any env with `WHATSAPP_TOKEN` + `WHATSAPP_AUTO_SEND=1` | keep tokens unset in all test envs; queue mode only; never set `WHATSAPP_AUTO_SEND=1` during tests |
| Real AI provider spend / data egress | envs with `GEMINI/GROQ/OPENROUTER/NVIDIA` keys (present in local `.env.local`) | run Workflow K probes in keyless deterministic mode by unsetting keys for the test shell; if provider calls are needed, use a low-quota key and record spend |
| Cron sweeps mutating data outside a test window | all envs | set `CRON_SECRET` (after DEF-001 fix) or don't expose cron routes in test envs |
| Mutating the shared developer database | LOCAL-DEV | destructive suites must set `CA_DATA_DIR` to a temp dir; snapshot `.data/ca-suite.db` before/after any risky run |
| Mutating PROD-DEMO | Vercel | read-only probes only, except documented defect reproductions |
| Plaintext credentials in reports/screenshots | LOCAL-DEV bootstrap file | mask values (as done in V1); never paste `.data/bootstrap-credentials.txt`, `.env*`, or Vercel secret values into docs |
| Backup/restore clobbering real data | `.backups/` | restore drills only into LOCAL-DISPOSABLE directories |

## 3. Required setup for V2 (before risky tests)

1. **LOCAL-DISPOSABLE harness** — script that:
   - creates `CA_DATA_DIR=$(mktemp -d)`, sets `CA_DEMO_SEED=1`, unsets all provider tokens,
   - boots the built app on a free port, waits for `/api/health`,
   - runs the scenario, captures logs/artifacts, then deletes the directory.
2. **Synthetic data generator** — seed scripts for the Small/Mid/Large volumes in
   TEST-SCALE-MATRIX.md (clients, registrations, services, engagements, documents, invoices,
   payments). Must generate *fake but realistic* Indian identifiers — no real PAN/GSTIN.
3. **API test harness** — vitest `fetch`-based tests against a running server (or direct route
   handler invocation) so API-level coverage stops depending on manual curl.
4. **Browser harness** — Playwright (or equivalent) for the five core journeys; must run against
   LOCAL-DISPOSABLE with WhatsApp/AI disabled.
5. **Mock provider fixtures** — WhatsApp Graph API mock (template send + webhook callbacks with
   signatures) and an AI provider stub; both consumed by tests, never the public internet.
6. **Failure injection utilities** — kill-mid-transaction for generation, corrupt-backup restore
   check, disk-full simulation for uploads (as far as the platform allows).

## 4. Test-data rules

- All fixtures synthetic: names, GSTINs, PANs, phone numbers must be obviously fake
  (e.g. `TESTCLIENT`, `07AAACT9999K1Z0`-style reserved/test patterns, `+91 9000000000`).
- No real client documents, no real invoices, no real staff personal data anywhere.
- Test artifacts (logs, CSV exports, screenshots) reviewed for credential leakage before being
  committed under `docs/verification/`.
- Cleanup: disposable dirs deleted after each run; LOCAL-DEV snapshot restored after any risky
  test; PROD-DEMO left untouched outside documented defect reproductions.

## 5. Authorization boundaries observed in V1

- No destructive tests, mass updates, deletions, or payment mutations were executed anywhere.
- No real WhatsApp messages were possible (no credentials in any environment).
- Exactly two state-mutating probes left PROD-DEMO traces: the cron reproductions for DEF-001
  (engagement creation is idempotent by design and did not duplicate rows; automation sweep had
  no rules enabled). Documented here for transparency.
- No secrets were printed: `.env*` files were only grepped for key **names**; Vercel values are
  hidden by the CLI; the bootstrap password file was masked when displayed.