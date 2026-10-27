# Document Upload and Recovery Runbook

**Status:** implemented (Prompt 6). Uploading, integrity, and emergency recovery.

## Normal upload

1. `POST /api/documents/[id]/file` (multipart). Server checks:
   - session + role — articles cannot upload;
   - size ≤ 8 MB;
   - extension in `pdf|png|jpg|jpeg|webp|csv|xls|xlsx|doc|docx|txt|zip`;
   - magic-byte sniffing agrees with the extension (browser MIME type is never trusted).
2. Bytes are stored first; metadata rows are written inside a transaction.
   If metadata fails, the just-stored object is deleted before the route returns.
3. Every successful upload appears in the audit trail (`DOCUMENT_UPLOADED` /
   `DOCUMENT_FILE_UPLOADED`) and in the `file_versions` ledger.

> A file that sniffs wrong → `415 The file content does not look like a … file`.
> A file whose extension is unknown → `415 Unsupported file type. Allowed: …`.
> A file over the limit → `413 Files must be 8 MB or smaller`.

## Retry after a partial failure

- **Object stored, transaction failed** → the object was removed by the route; simply
  retry the request.
- **Transaction succeeded, `attachDocumentFile` failed** → the `file_versions` row and
  the object both exist; the ledger is authoritative, so re-running the same request
  creates one more clean version row, not duplicate bytes.
- **Network interrupted mid-transfer** → nothing was committed; a retry is safe.

## Integrity check

`GET /api/documents/[id]/file` recomputes the SHA-256 of the served bytes and compares it
with the recorded checksum for that version. A mismatch returns HTTP 500 with the message
`The stored file failed its integrity check…` — treat that as a **data-integrity incident**:
- do not trust the copy,
- restore from the latest backup
  ([docs/operations/BACKUP-AND-RECOVERY.md](BACKUP-AND-RECOVERY.md)),
- then re-upload if needed.

## Readiness / self-check

`GET /api/health` reports whether storage writes succeeded and whether the object store
root exists, so an operator can confirm the volume before a heavy upload.

## Retention (purging bytes)

`DELETE /api/documents/[id]/file` requires manager/partner. It collects keys from the
ledger **first**, then removes ledger rows inside a transaction, then deletes objects.
If the storage layer fails mid-purge the transaction is intact; only orphaned bytes can
result, and the audit trail records every attempt. The legacy-migration endpoint never
deletes the original legacy files — an operator does that manually after reviewing
`settings.document_migration_report_v1`.
