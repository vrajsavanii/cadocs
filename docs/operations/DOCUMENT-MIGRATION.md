# Document Legacy Migration

**Status:** implemented (Prompt 6), `POST /api/documents/migrate-legacy` (partner-only),
logic in [lib/documents.ts→migrateLegacyDocuments](../../lib/documents.ts).

## When to run it

Documents uploaded to CADocs before the object-storage upgrade (Prompt 6) live directly
under `<data dir>/uploads/` and are referenced from `documents.file_path` by a bare
filename. After migration those rows point at opaque object keys
(`docs/<docId>/<stamp>-<name>`) written by the storage adapter, and their bytes are
verified by SHA-256.

## The procedure

1. **Back up first.** Snapshot the database and the uploads directory —
   [docs/operations/BACKUP-AND-RECOVERY.md](BACKUP-AND-RECOVERY.md).
2. Trigger the migration end point as a partner.
   - Only rows with a non-empty, *unsafe* (legacy-shaped) `file_path` are touched;
     rows already migrated are skipped.
3. A row is *migrated* when:
   - the legacy file exists on disk,
   - its bytes are stored under a fresh opaque key,
   - the stored checksum matches the source bytes,
   - a `file_versions` row is appended with the `current` status and the column
     `documents.file_path` is repointed.
   The **original legacy file is never deleted** by the migration itself.
4. A retry-safe summary is persisted to
   `settings.document_migration_report_v1` and written to the audit log with counts
   `scanned / migrated / verified / skipped / failed`.

## Failure handling

- Missing legacy file → `failed`, with the reason in `report.failures`. The row is left
  unchanged — no destructive half-action.
- Checksum mismatch after storage → the operation throws for that row and is recorded as
  `failed`; nothing else in the run is affected.
- A previously-migrated row whose bytes match another ledger key is re-pointed there
  (`skipped`), avoiding duplicate bytes.

## Cleaning up afterwards

Only **after** a successful report, and only under a retention decision, should the
operator remove the corresponding files from `<data dir>/uploads/`. Removing them
earlier risks breaking the legacy download branch used by rows the run skipped.
