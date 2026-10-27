# Billing data model (Prompt 10)

Migration `billing-v2` (schema version 7 in [lib/db.ts](../../lib/db.ts)) adds the billing tables and
columns around the legacy `invoices`/`payments` tables. Money invariant: **canonical amounts are
integers in paise**; the legacy REAL `amount`/`gst_amount`/`total_amount`/`paid_amount` columns are
kept for the existing UI and are always derived from — never authoritative over — the paise columns.

## Tables & columns

### `billing_settings` (single row, `id = 1`)
Firm billing configuration listed in [BILLING.md](../product/BILLING.md). `approval_required_for_auto`
defaults to 1, `approval_required_for_manual` to 0, `deliver_on_issue` to 1.
Legacy `settings.invoice_due_days` (1–90) seeds `default_payment_terms_days` once at migration.

### `tax_treatments`
`{treatment_id, name, kind: none|gst, rate_bp (nullable), active, note, updated_by, updated_at}`.
`rate_bp = NULL` means "partner has not configured a rate" — drafts compute zero tax, issuance blocks.

### `invoices` — new columns (via `ensureColumn`)
- Lifecycle: `lifecycle` (`draft|pending_approval|approved|issued|cancelled`), `status` (legacy
  display status), `billing_event_key` (idempotency identity).
- Numbering: `invoice_number`, `fy` (unique partial index on non-empty `invoice_number`; unique
  partial index on non-empty `billing_event_key`).
- Canonical money: `taxable_paise`, `gst_paise`, `total_paise`, `paid_paise`, `credit_paise`.
- Accountability: `approved_by/at`, `issued_by/at`, `issue_snapshot` (frozen JSON), `notes`,
  `cancelled_at/by`, `cancel_reason`.
- PDF: `pdf_object_key`, `pdf_checksum`, `pdf_size`, `pdf_version`, `pdf_generated_at`.

### `invoice_lines`
Line items frozen at draft time (editable while the draft is open, re-frozen at issue):
`{seq, description, service_code, client_service_id, compliance_id, registration_id, quantity,
unit_price_paise, discount_paise, taxable_paise, treatment_id, tax_kind, gst_rate_bp, cgst_paise,
sgst_paise, igst_paise, line_total_paise}`. Indexed `(invoice_id, seq)`.

### `payments` — new columns
`status` (`Confirmed | Pending reconciliation | Reversed`, default `Confirmed`), `recorded_by`,
`reversal_of`. Ledger semantics documented in
[RECEIVABLES-PAYMENT-TRACKING.md](../product/RECEIVABLES-PAYMENT-TRACKING.md).

### `credit_notes`
`{credit_note_id, invoice_id, number (unique), fy, reason, taxable_paise, gst_paise, total_paise,
status, created_by/at, voided_at/by}`.

### `invoice_events` (append-only)
`{event_id, invoice_id, event, actor, role, detail, created_at}` with BEFORE UPDATE/DELETE triggers
that `RAISE(ABORT, 'invoice event history is append-only')`. Every lifecycle, payment, credit note,
PDF and delivery action lands here, alongside firm-level `audit_log` entries.

## Legacy migration

Existing invoice rows are backfilled non-destructively: `lifecycle` derives from the old `status`
(`Cancelled` → `cancelled`, else `issued`), amounts are converted to paise exactly (`ROUND(x·100)`,
no re-taxation, numbers preserved), and `billing_event_key` is `compliance:{id}` when a compliance
link exists (`legacy:{invoice_id}` otherwise). A key collision gets a deterministic suffix without
touching any human number.

## Transactions & concurrency

Single-writer SQLite. Every multi-statement mutation (`createDraftInvoice`, `issueInvoice`,
`recordPaymentEntry`, `reversePaymentEntry`, `issueCreditNote`) runs inside `withTransaction`
(`BEGIN IMMEDIATE`), with fresh in-transaction reads for ceilings/aggregates and post-commit
side effects only (PDF write, WhatsApp send, audit already committed inside). The unique indexes are
the last line of defence for numbering and idempotency.
