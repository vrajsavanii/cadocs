# Database Architecture

> Status after Prompt 02 (Production Database, Persistent Storage & Recovery).

## Choice: persisted SQLite on an operator-controlled volume (Postgres-ready boundary)

NexAgent/CADocs is a single-firm practice suite running on Next.js. Its data
layer is a synchronous SQLite database (`node:sqlite`, the Node built-in
driver) accessed through a thin helper layer in [lib/db.ts](../../lib/db.ts).

For a **long-lived process joined to a real volume** (VPS, container mount,
single-node deployment), persisted SQLite is the correct production choice in
this deployment topology: transactional, zero-dependency, backed up with one
command, and fast for this workload (a single firm's records).

**It is not safe on serverless/multi-instance hosts** — two instances cannot
share one SQLite file, and the filesystem itself is ephemeral. For that
topology the platform layer is designed to swap the spine to **managed
PostgreSQL** without touching the domain layer. What already exists for that
transition:

- All durable configuration is centralised in [lib/config.ts](../../lib/config.ts);
  the storage mode is validated at boot and misconfiguration fails loudly.
- The schema now carries **real database invariants** (unique keys, indexes)
  rather than application-level checks, which carry over to Postgres.
- The migration tooling ([lib/backup.ts](../../lib/backup.ts),
  [scripts/migrate-to-volume.ts](../../scripts/migrate-to-volume.ts)) verifies
  row counts and file integrity, so moving to a new engine is an operator
  runbook, not a rewrite.
- No SQLite-specific SQL beyond `PRAGMA table_info` is used for data access;
  queries are portable SQL.

Adding Postgres (or a real cluster) is a deliberate infrastructure step that
needs an account, credentials and a cutover window — see the roadmap. Until a
postgres driver is introduced, the platform refuses to run business writes on
ephemeral storage (see below), which is the single most important guard.

## Where state lives

| Kind | Path | Survives |
| --- | --- | --- |
| SQLite database | `CA_DATA_DIR/ca-suite.db` | restarts, deployments (when volume-backed) |
| Runtime keys | `CA_DATA_DIR/field.key`, `session.key` | same |
| Uploaded objects | `CA_DATA_DIR/uploads/` (local provider) or R2 | same |
| Backups (operator-made) | elsewhere — never inside the app data dir | operator policy |

`CA_DATA_DIR` is mandatory in production. On serverless hosts the process
refuses to boot with an ephemeral path unless an operator has explicitly
declared the install a demo with `CA_ALLOW_EPHEMERAL=1`.

## Schema and invariants

Core tables: `clients`, `client_services`, `compliance`, `document_requests`,
`documents`, `file_versions`, `invoices`, `payments`, `messages`, `udin`,
`dsc`, `notices`, `leads`, `proposals`, `campaigns`, `timesheets`,
`automation_rules`, `automation_runs`, `ai_actions`, `ai_calls`, `users`,
`audit_log`, `jobs`, `schema_migrations`, `settings`.

Database-level guarantees added by migration 2 (the point of DB constraints is
that two concurrent requests cannot conspire to corrupt):

- `UNIQUE(compliance(client_id, service_code, period))` — one engagement cycle
  per client/service/period, partial-indexed on non-empty service codes.
- `UNIQUE(invoices.compliance_id)` — one auto-invoice per completed cycle.
- `UNIQUE(messages.automation_key)` — one queued/sent message per logical
  reminder or notification event (idempotency key), legacy rows deduplicated
  into the newest entry during migration.
- `UNIQUE(client_services(client_id, service_code))`, `UNIQUE(documents(...))`
  for checklist rows, `UNIQUE(udin)`.
- `file_versions(doc_id, version)` — content version ledger.

Sensitive identifier columns (`clients.pan`, `clients.gst_number`,
`clients.tan`) are AES-256-GCM encrypted at rest
([lib/crypto.ts](../../lib/crypto.ts)); the encryption key is provided outside
the database (env var or 0600 key file), so a leaked database file alone does
not leak identifiers.

## Migrations

`lib/db.ts` runs a **versioned migration ledger** (`schema_migrations`):

1. `v3.0 bootstrap` — the original `CREATE TABLE`/`ensureColumn` chain,
   recognised retroactively as version 1 so the ledger started complete.
2. `persistence-hardening` — the constraints, duplicate-merge, `file_versions`
   and `jobs` tables described above. Runs inside `BEGIN IMMEDIATE` and is
   rolled back whole on failure; a partial migration cannot survive.

Each migration's name, version and timestamp are recorded. Failed migrations
raise a clear error naming the migration; the operator can inspect and retry —
the retry is safe because the migration either fully applied or not at all.

Steps for adding a migration: append an entry to `PERSISTENCE_MIGRATIONS` with
the next version number and an `apply(db)` body. Do not add columns/tables
outside the ledger.

## Transactions and concurrency

- [lib/db.ts](../../lib/db.ts) exports `withTransaction(fn)`: wraps a group of
  writes in `BEGIN IMMEDIATE … COMMIT/ROLLBACK`.
- Every write that closes one logical unit of work runs in a transaction:
  engagement-cycle creation (task + document request + checklist + timeline),
  service enrolment, payment recording (already), invoice + `billed` flag,
  file-version ledger updates, all job-queue operations.
- External HTTP calls (WhatsApp, provider webhooks) are **never** inside a
  transaction; durability is established first, delivery happensthen.
- Concurrency-sensitive uniqueness is enforced by the database (above), not by
  application "check then insert" alone; where both exist, the DB constraint
  is the last line of defence and errors surface as deliberate
  "Already invoiced"-style idempotent results.
- `BEGIN IMMEDIATE` plus SQLite's file locking serialises cross-process
  writers safely; the node:sqlite driver runs the single connection per
  process (memoised on `globalThis`), WAL is off for dev-server friendliness
  and DELETE journalling is used.

## The durable job queue

`jobs` table + [lib/jobs.ts](../../lib/jobs.ts): idempotent enqueue by
`logical_key` (unique index), atomic claim (`claimDueJobs`), retry with linear
backoff, terminal `dead` state for operator review, and automatic reclaim of
jobs whose worker died >10 minutes ago. Jobs persist across restarts; a job is
"completed" only via an explicit `completeJob` after its side effect has
actually happened.

## Health and observability

`GET /api/health` reports component status: process, database connectivity,
storage configuration mode (persistent vs demo-ephemeral), object-storage
reachability, applied/pending migrations and queue depth. It returns only
operational facts — no credentials, paths, SQL or customer data — and responds
`503` when durability is degraded. Fail-safe rule: a business write is never
acknowledged as successful unless the durable write completed (transactions +
checksum-verified storage).

## Backup

See [docs/operations/BACKUP-AND-RECOVERY.md](../operations/BACKUP-AND-RECOVERY.md).
