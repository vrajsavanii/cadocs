# Document Management

**Status:** implemented (Prompt 6, migration 6 in [lib/db.ts](../../lib/db.ts), logic in
[lib/documents.ts](../../lib/documents.ts) and [lib/storage.ts](../../lib/storage.ts)).

## What exists

| Capability | Route | Notes |
|---|---|---|
| Request / create a document row | `POST /api/documents` (manager+) | `category`, `fy`, `period`, `service_code`, `compliance_id`, `request_id` accepted; server defaults `fy = fyForDate(requested_date)` |
| Filtered, paginated library | `GET /api/documents` | server filters: client, status, FY, AY, period, service, category, filing, request, name text, archived flag, needs-classification, page/pageSize |
| Upload / replace bytes | `POST /api/documents/[id]/file` (manager+) | append-only version ledger, content sniffing, checksum |
| Download (any version) | `GET /api/documents/[id]/file?version=n` | permission checks, integrity check, `attachment` disposition |
| Review decisions | `PATCH /api/documents/[id]` `action=status` | manager+ may Verify/Reject/Waive; rejection requires a written reason |
| Classification / folder move | `PATCH /api/documents/[id]` `action=classify` | any signed-in staff may flag; category/FY/AY/service/period/registration checks validated server-side |
| Archive (soft delete) | `PATCH /api/documents/[id]` `action=archive` / `restore` | manager+; audit + status history |
| Purge bytes (retention decision) | `DELETE /api/documents/[id]/file` | manager+; collects keys first, then removes them, transaction last |
| Version history | `GET /api/documents/[id]/versions` | no object keys returned, only metadata |
| Legacy migration | `POST /api/documents/migrate-legacy` (partner only) | retry-safe, checksum-verified, original legacy files are never deleted |

## Hard rules encoded in the server

- A **replacement upload resets review state** — prior approval never carries to new bytes
  ([lib/db.ts→attachDocumentFile](../../lib/db.ts)).
- Only a **manager or partner** may verify/reject/waive a document; the check lives in
  [lib/documents.ts→reviewDocument](../../lib/documents.ts), not the UI.
- Rejection requires ≥ 3 characters of written reason.
- A document cannot be **Verified before it has been Received** (409).
- Approving a document never marks the underlying return filed; filing state lives on the
  compliance row and needs its own transitions.
- Object storage keys are opaque (`docs/<docId>/<stamp>-<rand>-<safe-name>`); PANs, client
  names, GSTINs and assessment data never appear in a storage path.
- Storage paths are never exposed in any public API response.
- Every upload/download/review/archive/purge/migration step lands in the audit log.

## Review lifecycle

`Pending → Received → (Verified | Rejected)`, with `Waived` for closed-with-no-bytes
paper records, `Superseded` on the previous *version row* when a fresh upload replaces it,
and a soft `archived_at` marking on archival. Each transition is appended to
`document_status_history` (append-only trigger in migration 5).

## Search scope

Search is **metadata search only** — document name, category, period, FY, status and free
filename text (`q` string search over `document_name || ' ' || client_name`). There is no
content indexing; `docs/product/CLIENT-FOLDER-STRUCTURE.md` describes the folder model.
