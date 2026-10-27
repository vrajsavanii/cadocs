# Client Folder Structure

**Status:** implemented (Prompt 6). The folder model is *logical metadata* on the document
row (`fy`, `ay`, `category`, `service_code`, `period`, `compliance_id`, `registration_id`,
`needs_classification`) resolved on read — see
[lib/documents.ts→queryDocuments](../../lib/documents.ts) and the
[folders view](../../components/views/folders.tsx). No filesystem or object-storage
directory tree is created per client.

## Logical hierarchy

```
Client
└── Financial year (FY 2025-26) / Assessment year for tax records
    └── Service (gst | income_tax | tds | audit | payroll | …)
        └── Compliance type or period (month label / quarter label)
            └── Documents (optional compliance_id link)
```

- Financial-year labels are always `FY <yyyy>-<nn>` (`FY_LABEL` in
  [lib/documents.ts](../../lib/documents.ts)); assessments use `AY <yyyy>-<nn>` separately
  (`ay` column) — the two are never mixed in one field.
- Period folders are **virtual**: the `period` string is whatever the operator entered
  (month/quarter labels) and no empty folder is created for a future month.
- Filing registration linkage uses `registration_id`, validated to belong to the same
  client via `client_registrations`.
- A document may additionally link to one **filing** (`compliance_id`), validated
  server-side to belong to the same client.
- Every field change goes through the audit trail (`DOCUMENT_CLASSIFIED`).

## Needs classification

Documents whose firm-relevant metadata cannot confidently be set (legacy rows, doubts
about the FY, etc.) flag `needs_classification = 1`. Server-side:

- The client library can filter with `?needs_classification=1`.
- The upload route accepts `needs_classification=1` explicitly; a documented "no
  confident category yet" batch path exists so a legacy record never gets forced into a
  wrong folder or ignored.
- Unclassified rows carry the flag in the documents table, the folders view, and the
  dashboard's chase list.
