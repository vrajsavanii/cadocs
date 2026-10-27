# File Storage Architecture

> Status after Prompt 02.

## Design

Client documents are stored **outside every web-served directory**, addressed
by **opaque server-generated keys**, with all metadata and permissions in the
database. Nothing about the filesystem layout escapes the server:

- keys look like `docs/DOC-045/17abc-64a4/bank-statement.pdf` — no client
  names, no FY/category folder traversal, no absolute paths;
- downloads stream through the authorised API route
  (`GET /api/documents/:id/file`, session-gated like every other API route —
  [proxy.ts](../../proxy.ts)), and only exist for documents the session's role
  is allowed to see;
- when object storage (R2) is on, the route instead issues a **short-lived
  presigned GET** after the same server-side permission check (TTL 30–3600s).

## Providers

Selected with `CA_STORAGE_PROVIDER` ([lib/config.ts](../../lib/config.ts)):

| Provider | Bytes live | Use when |
| --- | --- | --- |
| `local` (default) | `CA_DATA_DIR/uploads/` (0600 files, no+exec-friendly permissions) | persistent-volume deployments, development |
| `r2` | Cloudflare R2 via SigV4-signed fetch (no SDK dependency) | multi-instance/serverless deployments |

R2 requires `CA_R2_ACCOUNT_ID`, `CA_R2_ACCESS_KEY_ID`,
`CA_R2_SECRET_ACCESS_KEY`, `CA_R2_BUCKET`; configuration is validated at boot
and the process refuses to start with the provider selected and credentials
missing. Both providers are behind one interface ([lib/storage.ts]):
`putObject` / `getObject` / `deleteObject` / `objectExists` /
`presignDownload`; nothing else may touch uploaded bytes.

## Metadata, integrity, versions

- Every upload records a **SHA-256 checksum** and byte size, both from the
  bytes actually stored. Downloads always re-read from the storage provider,
  so a corrupt cache cannot serve wrong content; the migration and backup
  tooling re-hash files against their recorded checksum to prove integrity.
- Every upload creates a row in `file_versions` (doc, version number, key,
  name, size, checksum, uploader, timestamp) inside a transaction with the
  document's status update — so metadata can never claim a file that failed to
  write, and replacing a document **keeps the previous bytes** under the
  version ledger until an explicit retention action.
- The delete endpoint (`DELETE /api/documents/:id/file`) is the single
  retention decision point: it removes the current object and all versioned
  predecessors of that document together, and records it in the audit log.

## Upload path and failure safety

1. Role-gated route validates the request, rejects empty files, sizes > 8 MB
   and disallowed extensions (pdf/png/jpg/jpeg/webp/csv/xls/xlsx/doc/docx/txt/zip).
2. Bytes are written via the storage provider.
3. `file_versions` + `documents` metadata are updated in one transaction; if
   the metadata write fails, the just-written bytes are deleted so no
   orphaned/untracked object lingers, and the upload errors out — a document
   never reports `Received` on a half-failed upload.
4. Successful upload marks the document `Received`, clears its next reminder
   and re-evaluates the parent document-request packet (`refreshRequestStatus`)
   so client-side automation stops the moment the last pending item lands.

## Malware scanning — documented limitation

There is **no automated malware scan** in this phase. Mitigations in place:
extension allow-list, size cap, opaque private keys (no scanning-host cache),
download-only serving, no HTML/SVG/header execution paths, and version
history (a malicious/incorrect upload can be reverted to the previous version
byte-for-byte before deletion). Where this is a deployed requirement, add a
provider-side pipeline (e.g. scan webhooks into a quarantine key namespace,
serve only `pass`-marked objects) — the key layout (`docs/<docId>/…`) already
supports a screening prefix without migration. Until then, treat downloads as
firm-internal and educate users not to open unexpected executables (which are
rejected at the gate anyway).

## Legacy files and migration

Files uploaded before object storage lived as `DOC-xxx-...` names inside the
uploads directory. They keep downloading through a legacy branch of the
document route (basename resolution, still traversal-guarded) —

- they are **never deleted automatically**;
- [scripts/migrate-to-volume.ts](../../scripts/migrate-to-volume.ts) and the
  backup verifier re-hash and re-check every file recorded in
  `file_versions`, so the runbook migrates them with evidence;
- retention decisions are explicit operator actions only.
