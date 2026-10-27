# Data Migration Runbook

Moving an existing CADocs/NexAgent deployment (its SQLite database, uploads
and decryption keys) onto a **persistent-volume data directory** — or
preparing the same evidence for the eventual engine cutover.

The tooling guarantees: the **source is never modified** during migration, no
production traffic switches automatically, and every step produces verifiable
evidence.

## Prerequisites

- You know the current data directory (`CA_DATA_DIR` env, or the project's
  `.data/` for a local install).
- The app is deployed from code whose health endpoint reports
  `migrations.pending: 0` (i.e. the migration ledger in this phase has
  applied). If not, deploy/run the app once against the legacy copy first —
  migrations 1–2 apply on boot.
- A maintenance window where the app can be stopped briefly (only makes a
  neater snapshot; the copy tool is also safe read-only during traffic).

## Procedure

### 1. Stop writes / note counts

Stop the app process (or note that live traffic may add rows — the verifier
only checks source == copy at copy time).

### 2. Back up first (always)

```
npm run backup -- --target <safe-encrypted-target>
npm run backup:verify -- --backup <safe-encrypted-target>
```

Do not proceed if verification fails. This backup is your rollback.

### 3. Copy to the new location

```
npx tsx scripts/migrate-to-volume.ts --source <current-data-dir> --target <new-volume-dir>
```

The tool copies `ca-suite.db`, `uploads/`, keys into the target (refusing if
the target already contains a database), then verifies:

- SQLite integrity + foreign keys on the copy;
- per-table row counts source vs copy (prints a table, fails on any mismatch);
- every `file_versions` object exists in the copy with matching size and
  SHA-256.

It exits 1 with a listing if anything failed, and reports exactly what
remains wrong. The source is untouched, so a failed attempt is always
retryable.

### 4. Authorise and cut over (operator action)

- Set `CA_DATA_DIR=<new-volume-dir>` in the hosting environment's config
  (secret store, not code).
- Start the app.
- `GET /api/health` must report `storage_config: persistent`, `database: ok`,
  `migrations.pending: 0`.
- Create one test client/document/invoice round-trip to confirm writes land
  (they now hit the volume, visible in the new directory).

### 5. Retire the source safely

Keep the old directory intact (renamed, e.g. `.data.retired-<date>`) for one
invoice/reminder cycle. Then delete per firm retention policy. The migration
tool never deletes it; deletion is a separate, deliberate decision.

## Rollback

At any time before retiring the source: point `CA_DATA_DIR` back at the
original directory and restart. No data was migrated in place, so rolling back
is just an env var change. Records created after cutover live only in the new
directory — re-run the copy tool (to a fresh target) + a differential note if
you need them.

## Validation checklist

- [ ] Backup verification passed (pre-flight).
- [ ] Row counts matched for every tracked table (tools prints each).
- [ ] All `file_versions` objects hashed identical in the copy.
- [ ] Health: `persistent`, no pending migrations.
- [ ] One end-to-end write round-trip after cutover (create a test client +
      doc request; delete it afterwards with a noted audit entry).

## Future engine cutover (SQLite → provider Postgres)

When a provider Postgres cluster is introduced, this same runbook extends:

1. Export via the backup snapshot (it is plain SQLite — any migration tool
   can read it).
2. Import into Postgres with the migration ledger applied there (migration 2's
   constraints are portable SQL).
3. Verify counts + sums for `invoices`/`payments` and every
   `file_versions` checksum before cutover.
4. Dual-write or stop-the-world cutover window; rollback = revert env.
   No such cutover happens without an explicit, documented operator
   authorisation.

## What this runbook does *not* cover

- Migrating into/out of R2 (provider-side; document later when R2 is enabled).
- Merging two firms' databases (needs tenant isolation first — roadmap
  Prompt 03).
