# Test Scale Matrix — NexAgent (Verification V1)

Volumes were chosen **after** inspecting the architecture (RULE 6):

- Storage is a single SQLite file (`node:sqlite`), single-writer process. Declared topology
  boundary (docs/architecture/DATABASE.md, docs/operations/PRODUCTION-ENVIRONMENT.md):
  one long-lived process owns the file; concurrent writers across machines are unsupported.
- Server-rendered Next.js with a per-user write rate limit of 300 mutations/minute (proxy.ts).
- Document files live on local disk (0600) unless `CA_STORAGE_PROVIDER=r2`.
- Therefore "large firm" scale is bounded by **single-process SQLite throughput**, not by the UI.

**Nothing in this matrix has been executed yet.** V1 ran only the baseline suite
(109 unit/integration tests) plus HTTP smoke probes. Every scale row is marked
`Planned (V2+)`; no scale pass may be claimed until run and recorded in
BASELINE-TEST-RESULTS.md or a later results file.

## Environment for scale runs

| Property | Value |
|---|---|
| Hardware | developer machine (Windows, Node ≥ 24), single process `next start` |
| Database | disposable `.data/scale-test.db` via `CA_DATA_DIR` override — **never** the shared dev DB, never Vercel |
| External services | none — WhatsApp queue mode only, AI keyless deterministic mode |
| Network | loopback only |

## Small firm (baseline scale — defines fixture shapes)

Synthetic practice: 1 partner, 1 manager, 3 articles, 25 clients, 40 GST registrations,
6 service types (GST monthly, TDS quarterly, ITR annual, tax audit annual, ROC, bookkeeping),
12 months of periods → ≈ 450 engagements, ≈ 1,500 documents, 150 invoices, 200 payments.

| # | Scenario | Volume | Duration | Success criteria | Status |
|---|---|---|---|---|---|
| S-1 | Seeded suite + full unit suite | as committed | ~30 s | 109/109 pass | **Executed (V1 baseline)** |
| S-2 | Onboard 25 clients, generate 12 months of engagements twice (idempotency) | 450 engagements | < 60 s | second run creates 0 duplicates | Planned (V2) |
| S-3 | Document upload of 150 mixed files (PDF/XLSX ≤ 10 MB) | 150 files | < 120 s | all retrievable, keys 0600, restart-persistent | Planned (V2) |
| S-4 | Dashboard + reports + CSV export under small-firm data | 1 user | < 3 s per request | totals reconcile with details | Planned (V2) |

## Mid-sized firm

1 partner, 3 managers, 16 articles, **500 clients**, 900 registrations (some clients with 2–3),
8 service types, 24 months → ≈ 9,600 engagements, 40,000 documents, 4,000 invoices, 6,000 payments.

| # | Scenario | Volume | Duration | Success criteria | Status |
|---|---|---|---|---|---|
| M-1 | Bulk client import (`POST /api/clients/bulk`) 500 rows | 500 | < 120 s | all valid rows persisted, invalid rows reported, no partial-commit corruption | Planned (V2) |
| M-2 | Monthly generation run across all services + rerun | 9,600 engagements | < 180 s | 0 duplicates, run record accurate (processed/created/skipped counts) | Planned (V2) |
| M-3 | Concurrent-ish API load: 8 interleaved sessions (sequential batches — SQLite single writer) | 2,000 mixed requests | < 300 s | no 500s, rate limiter engages only above 300 writes/min/user | Planned (V2) |
| M-4 | Reports with all global filters over 24 months | full data | < 5 s per report, export < 15 s | filter parity report↔export | Planned (V2) |
| M-5 | Automation sweep with 20 rules over 9,600 engagements | 1 sweep | < 300 s | run record + cadence gate prevent double action | Planned (V2) |

## Large firm (architecture-stress tier)

2 partners, 6 managers, 40 articles, **5,000 clients**, 9,000 registrations, 12 service types,
36 months → ≈ 108,000 engagements, 300,000 documents, 60,000 invoices.

| # | Scenario | Volume | Duration | Success criteria | Status |
|---|---|---|---|---|---|
| L-1 | Full generation + rerun at scale | 108,000 engagements | — | 0 duplicates; measure SQLite insert throughput; record MB growth | Planned — **likely to expose SQLite single-writer ceiling; result decides whether Postgres migration is a launch blocker** |
| L-2 | Reports/export at scale | 108,000 rows scanned | — | < 10 s report, < 60 s export, memory < 512 MB | Planned |
| L-3 | Concurrent users (20 sessions, read-heavy + throttled writes) | 5,000 requests | — | no DB "database is locked" errors; 429s only per policy | Planned |
| L-4 | Document volume (300k files) | — | — | upload/download < 2 s p95 local; R2 path optional | Planned (needs R2 credentials or local disk budget ≥ 30 GB) |
| L-5 | Scheduled jobs overlapping (automation + recurrence + backup) | 3 jobs concurrent | — | SQLite single-writer serialization holds; no corruption; backup still verifies | Planned |
| L-6 | Retry/recovery at scale (kill process mid-generation) | 108,000 | — | restart resumes without duplicates or orphans; run marked interrupted | Planned |
| L-7 | Tenant/role separation at scale | 50 users | — | role matrix holds for every API (programmatic sweep of proxy policy) | Planned |

## Explicit non-claims

- No concurrency, performance, or volume claim is made by this document. The only executed
  baseline is S-1 plus HTTP smoke probes (recorded in BASELINE-TEST-RESULTS.md).
- The deployed Vercel environment (**ephemeral demo storage**, DEF-002) is **not eligible** for
  any scale run: cold starts wipe data and separate instances hold separate databases.
- Scale runs must never execute against the production deployment or the shared developer
  database; fixture seeding must use `CA_DEMO_SEED`-style synthetic generators in a disposable
  `CA_DATA_DIR`.