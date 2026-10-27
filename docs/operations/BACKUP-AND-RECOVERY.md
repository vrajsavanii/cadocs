# Backup and Recovery

> Status after Prompt 02. This document separates **what is implemented and
> tested** from **what requires provider-level configuration** — backups are
> not "operational" until actually configured and tested.

## What exists today (implemented and executed)

- [scripts/backup.ts](../../scripts/backup.ts) — operator CLI:
  `npm run backup -- --target <dir>`. Takes a **transactionally consistent
  snapshot** of the SQLite database (`VACUUM INTO` — safe against concurrent
  writes, source stays read-only), copies the uploads tree, copies the
  decryption keys, then **verifies what it wrote** (integrity check, foreign
  keys, row counts, file checksums) before declaring success. Never touches
  live data.
- [scripts/restore-verify.ts](../../scripts/restore-verify.ts) —
  `npm run backup:verify -- --backup <dir>`. Read-only verification of any
  backup: opens the snapshot, runs `PRAGMA integrity_check` +
  `foreign_key_check`, compares row counts against the manifest, and re-hashes
  every versioned file against its stored checksum. This is the
  **non-production restoration test**; run it on every backup before trusting
  it.
- Both were executed against the real data directory in this phase; the
  snapshot verified clean (integrity ok, foreign keys ok, counts match).

**Important**: the snapshot bundle contains the field/session decryption keys
(0600). A backup without them cannot decrypt PAN/GSTIN columns after a restore.

## Required operator configuration (external to the app)

1. **Schedule** — run `backup` on the volume host at least daily, e.g.
   `0 2 * * * npm run backup -- --target /backup/ca-suite/$(date +\%w)` into a
   location the app process cannot write to.
2. **Encryption of backups** — encrypt the target (LUKS/VeraCrypt/age/`tar |
   age`) *before* it leaves the machine. Keys inside backups are essential,
   which is why the bundle must never live unencrypted in a shared bucket or
   repository.
3. **Off-site copy** — sync the encrypted bundles to object storage with
   versioning enabled. Backup credentials must not be stored in the app repo.
4. **Monitoring** — wrap the cron entry to alert on non-zero exit; the CLI
   exits 1 when verification fails, so a simple dead-man's check on manifest
   freshness also works (`backup-manifest.json` mtime older than 36h ⇒ alert).

## Object storage (R2) note

When `CA_STORAGE_PROVIDER=r2` is enabled, file data lives in the bucket;
enable **bucket versioning** there and exclude the `uploads` copy from local
snapshots (or keep the local copy as a belt-and-braces mirror). Object
versioning is provider-side configuration.

## Recovery targets (proposed — adjust to firm policy)

| Target | Proposal |
| --- | --- |
| RPO (max data loss) | ≤ 24 h with a daily backup; ≤ 1 h if you raise schedule to hourly (SQLite snapshots are cheap at this size). |
| RTO (max downtime) | ≤ 30 min on the same host: restore the bundle to `CA_DATA_DIR`, restart, run health check + restore-verify. |

## Recovery procedure

**Scenario A — accidental deletion / corruption discovered ("restore
.point")**: pick the newest *pre-incident* verified snapshot.

1. Stop the app (writes must not race a restore).
2. Move the current data dir aside (never delete the damaged state — it is
   evidence): `mv /var/ca-suite /var/ca-suite.damaged`.
3. Unpack/copy the snapshot into a fresh `CA_DATA_DIR`:
   `ca-suite-<ts>.db → ca-suite.db`, `uploads/` into place, keys into place
   (0600).
4. `npx tsx scripts/restore-verify.ts --backup <snapshot-dir>` — must PASS.
5. `npm run typecheck` unnecessary; instead hit `GET /api/health` and confirm
   `database.ok`, `migrations.pending: 0`.
6. Start the app, log in, spot-check the last audit-log entries against the
   incident window.
7. Only after verification, archive or delete the `.damaged` copy per
   retention policy.

**Scenario B — total volume loss**: provision the new volume, restore the
most recent snapshot per Scenario A, redeploy the app pointing at the new
`CA_DATA_DIR`.

**Scenario C — only documents lost / damaged** (individual objects):
`file_versions` gives previous checksums and keys; restore the previous
version copy from the newest snapshot containing it, re-hash against the
recorded checksum, then attach/verify in the UI. Retention decisions for the
damaged version are operator actions in the UI, not file surgery.

## Validation of referential integrity after a restore

`restore-verify` deliberately runs `PRAGMA foreign_key_check` over the
snapshot — zero violations is a passing gate, together with row counts and
file checksums. A restore that skips this step is not considered operating.

## Retention

Proposed: 7 daily + 4 weekly + 6 monthly snapshots (grandfather-father-son),
all encrypted; the snapshot naming from the scheduled job makes pruning a
simple file operation. Anything older than the accepted set should be
secure-deleted, not left scattered.
