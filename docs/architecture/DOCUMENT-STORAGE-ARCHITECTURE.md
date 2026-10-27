# Document Storage Architecture

**Status:** implemented (Prompt 6). Storage lives in [lib/storage.ts](../../lib/storage.ts);
schema lives in migrations 5–6 of [lib/db.ts](../DATABASE.md); upload/download handlers live
in [app/api/documents/[id]/file/route.ts](../../app/api/documents/[id]/file/route.ts).

## Layers

1. **Metadata** — the SQLite `documents` table (name, client, FY/AY, category, service,
   period, filing/registration links, review state) plus the `file_versions` ledger
   (`version`, `object_key`, `file_name`, `size_bytes`, checksum, uploader, `status`
   = `current` | `superseded`, `superseded_at`, `change_reason`).
2. **Bytes** — the storage adapter in [lib/storage.ts](../../lib/storage.ts):
   `putObject`, `getObject`, `deleteObject`, `objectExists`, `objectKeyFor`,
   `objectKeyIsSafe`, `sniffType`, `sha256Hex`. Keys are opaque
   (`docs/<docId>/<timestamp>-<rand>-<safe-name>`) and never carry PAN/GSTIN/client names.
3. **Authorization** — every read/write route resolves the session, the document row and
   the client link before touching storage; knowing a document ID or object key never
   grants access.
4. **Review state** — `documents.status` plus the append-only `document_status_history`.
5. **Audit log** — every upload/download/review/archive/purge/migration action.

## Consistency model (uploads)

Storage is *not* transactional with SQLite. The chosen order:

1. Validate session, role (manager+ for uploads), size (≤ 8 MB), extension allowlist
   and sniffed content type.
2. `putObject` — bytes land first under an opaque key.
3. `recordFileVersion` inside a transaction — appends the new `current` row and
   supersedes the previous one. **A metadata failure after a successful object write
   deletes the just-stored object**, so no row ever points at nothing and no orphan
   survives the happy path.
4. `attachDocumentFile` — updates the human-facing fields and **resets review state**
   because new bytes have never been reviewed.

Failure handling: if step 4 fails after step 3 succeeded, the bytes and the ledger row
both exist and the operator can retry the update; nothing half-broken is silently
cleaned away, and the audit trail records what happened.

## Deletions

`purgeDocumentBytes` ([lib/documents.ts](../../lib/documents.ts)) collects every key from
the ledger **before** removing the DB rows, deletes the rows inside a transaction, then
removes the objects. A crash between the two leaves orphaned bytes at worst — never a
document pointing at missing bytes. Legacy (pre-storage) files are unlinked from the
uploads directory only when they match the expected naming pattern. **Never** run a
permanent wipe from a UI handler; use the retention-decision route and log it.

## Legacy migration

`POST /api/documents/migrate-legacy` (partner-only) re-homes documents uploaded before
object storage. It is idempotent, verifies checksums, leaves original legacy files in
place, and reports `scanned/migrated/verified/skipped/failed` counts.
See [docs/operations/DOCUMENT-MIGRATION.md](../operations/DOCUMENT-MIGRATION.md).

## Retention and recovery

- Archival is a **soft delete**: `archived_at` is set and the row leaves active queries
  but the bytes stay until a manager/partner makes an explicit retention decision.
- Backups snapshot state inside the data dir (see
  [docs/operations/BACKUP-AND-RECOVERY.md](../operations/BACKUP-AND-RECOVERY.md)); the
  verification routine cross-checks checksums for every ledger row.
