# Document Access Controls

**Status:** implemented (Prompt 6). Enforcement lives in
[app/api/documents/**](../../app/api/documents) and
[lib/documents.ts](../../lib/documents.ts); the role model is defined in
[lib/auth.ts](../../lib/auth.ts) and documented in
[docs/architecture/DATABASE.md](../architecture/DATABASE.md).

## Roles

| Role | Upload / replace bytes | Verify / reject / waive | Archive / restore | Delete bytes (purge) | Run legacy migration |
|---|---|---|---|---|---|
| partner | ✔ | ✔ | ✔ | ✔ | ✔ |
| manager | ✔ | ✔ | ✔ | ✔ | ✖ (403) |
| article | ✖ (403) | ✖ (403) | ✖ (403) | ✖ (403) | ✖ |

Articles may read rows (see below) but never change review state or storage.

## Firm isolation

- Every route resolves the **signed-in user** before touching a row; unauthenticated
  requests get `401`.
- A document is reachable only through its `client_id`; the storage key alone never
  grants access — `GET /api/documents/[id]/file` re-resolves the DB row and the session
  every time.
- Object keys are opaque (`docs/<docId>/…`), storage paths are **never** returned by any
  public API, and the version-history response strips them.
- Knowing or guessing a document ID does not bypass authorization; the download route
  calls `getDocument(id)` and follows the same role rules as the metadata routes.

## What is logged

`logAudit` records:

- `DOCUMENT_UPLOADED`, `DOCUMENT_FILE_UPLOADED`, `DOCUMENT_FILE_REMOVED`,
- `DOCUMENT_RECEIVED` / `DOCUMENT_VERIFIED` / `DOCUMENT_REJECTED` / `DOCUMENT_WAIVED`,
- `DOCUMENT_CLASSIFIED` (any folder/classification move),
- `DOCUMENT_ARCHIVED` / `DOCUMENT_RESTORED`,
- `DOCUMENT_BYTES_PURGED`,
- `DOCUMENT_LEGACY_MIGRATED` and `DOCUMENT_LEGACY_MIGRATION_RUN`.

Nothing that logs file **contents**, storage paths, object signatures or client
identifiers beyond the document name; rejection reasons are truncated to 120 chars.

## Rules enforced server-side

- Only a manager or a partner may verify/reject/waive a document; the check lives in
  `reviewDocument`, not in the UI, so a crafted PATCH is rejected with 403.
- Rejection requires a written reason ≥ 3 characters.
- A document cannot be verified before it is received (`409`).
- A replacement upload **resets** review state (`Pending`, unverified) — old approvals
  intentionally do not carry to new bytes.
- Registering a classification against a filing (`compliance_id`) that does not belong to
  the same client returns `409`; the same rule applies to registration moves
  (`client_registrations` lookup).
- Empty, oversized, unknown-extension, or content/extension-mismatched uploads are
  rejected (`400/413/415`) before the object store is touched.
- `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on every
  download response; never inline-render of a PDF/HTML from an untrusted origin.

## What is deliberately *not* implemented

- Malware scanning — no scanner is wired in, so uploads are never described as scanned.
- Government ID verification — a document being Approved/Verified does **not** mean the
  underlying statutory filing is verified; that is a separate workflow
  (see [docs/product/DUE-DATE-RULES.md](../product/DUE-DATE-RULES.md)).
- Signed URLs / external CDN access — downloads are plain authenticated responses so the
  authorization check cannot be bypassed by forwarding a URL.
