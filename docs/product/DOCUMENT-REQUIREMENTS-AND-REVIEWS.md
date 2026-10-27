# Document Requirements, Checklists and Reviews

**Status:** implemented (Prompt 6) — checklist templates are snapshotted into packet
requests at creation time ([lib/engagements-db.ts→checklistTemplate](../../lib/engagements-db.ts)
/ `ensureChecklistForCycle`), and every requirement the packet creates is a real
`documents` row that follows the full review workflow.

## Checklist templates

- A template belongs to a **service code** and carries a `version` (see the
  `checklist_templates` table in [lib/db.ts](../../lib/db.ts)).
- When a document-request "cycle" is created for a filing or service period, the current
  template's items are **snapshotted** — copied onto real Pending document rows — so a
  later template update never mutates the checklist of an in-progress engagement.
- A file uploaded under a requirement is linked via `request_id` on the document row.
- Reminder limits (`Reminder cap is between 1 and 3`) live in `documents_settings` and
  are validated server-side.

## Requirements are document rows

Each requirement raised (from templates, manual requests, or per-filing automation) is
stored as a standard document row with:

- `client_id`, `client_name`, `service_code`, `fy`, `period`, `category`
- `request_id` (the packet) and `compliance_id` (the filing) as foreign references
- `status` — `Pending` (requested, nothing received), `Received` (bytes in, unreviewed),
  `Verified`, `Rejected`, `Waived`
- `request_id`-based resolution in `ensureChecklistForCycle`, so the packet's completeness
  ("what's still missing") is computed by asking which members are not yet `Received` or
  beyond ([lib/engagements-db.ts→refreshRequestStatus](../../lib/engagements-db.ts)).

"How received is this packet?" is answered exactly once, by **counting rows**, never by
looking at a file in storage.

## Rejection and replacement

- Rejecting a document requires a manager/partner role **and** a written reason (≥ 3
  chars) — see [DOCUMENT-MANAGEMENT.md](DOCUMENT-MANAGEMENT.md).
- A rejected document's replacement upload resets review state but keeps:
  - the previous version in storage under the version ledger,
  - a row in `document_status_history` recording `Rejected`, and
  - the `review_reason` visible in the documents view until the next verification.
- Waiving a requirement is manager+ only (the sample allows `partner`/`manager` /
  reference roles — see `MANAGER_ROLES` in [lib/documents.ts](../../lib/documents.ts)).
