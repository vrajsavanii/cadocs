# Billing (Prompt 10)

Billing for the CA practice runs on one engine: [lib/invoicing.ts](../../lib/invoicing.ts) owns every
invoice state transition, number allocation, line tax computation, payment entry and credit note.
Automation on top of it lives in [lib/billing.ts](../../lib/billing.ts).

## Switching billing on

A partner enables billing under **Settings → Billing** (`billing_settings.billing_enabled`, one row,
id 1). While billing is off, manual draft creation is refused (409). The automation sweep is not
affected by this flag alone — engine drafts always also require the client service to have
`auto_invoice` enabled.

## Firm billing settings

Fields: legal/display name, address, contact, PAN, GSTIN, invoice prefix (`NV`), credit-note prefix
(`NC`), numbering policy (`per_fy` or sequential), currency, default payment terms (days),
internal billing contact, invoice footer, payment instructions, bank details, invoice grouping,
approval requirements for auto/manual drafts, deliver-on-issue flag, and configurable ageing
buckets (default `[30,60,90]`). Only a partner may change any of these; every change is audit-logged.
A legacy `invoice_due_days` setting is honoured once at migration.

## Tax treatments

Rates are never invented by code. Treatments are firm-configured rows in `tax_treatments`
(kind `none` or `gst`, rate in basis points). Two treatments are seeded:

- `TAX-NONE` — no GST charged (the firm asserts this is correct).
- `TAX-GST-UNCONFIGURED` — a GST treatment with **no rate**. Drafts using it carry zero tax, and
  issuance refuses until a partner sets the rate through billing settings.

Intra-state supplies (firm GSTIN state code == client state code) are split CGST + SGST (odd paise to
SGST); inter-state supplies use IGST. The auto-billing default treatment is partner-selectable
(`billing_auto_treatment_id`).

## Invoice lifecycle

```
draft → pending_approval → approved → issued → (paid / partially paid / cancelled)
            ↓ reject (reason)          ↓ cancel (partner, reason)
          draft                     cancelled
  void (unissued draft → cancelled)
```

- **Draft** — manual (`POST /api/invoices`) or engine-created (`billing_event_key` keyed, idempotent).
  Editable freely; no human number exists yet.
- **Submit / Approve** — approval requirement follows firm settings; self-approval is refused.
- **Issue** — human number allocated inside the finalisation transaction, totals and line items
  frozen into `issue_snapshot`. PDF generation and WhatsApp delivery run *after* the commit, so a
  messaging or storage failure can never leave the invoice dangling and neither can resurrect it.
- **Cancel** — partner-only with a reason; already-received history is preserved.

## Duplicate safety (job retries)

Every engine draft carries `billing_event_key = compliance:{id}`; a unique partial index on
`invoices(billing_event_key)` makes a raced duplicate insertion impossible, and the pre-lookup
degrades a retry to a no-op returning the existing draft. `compliance.billed` flips to 1 in the same
transaction as draft creation.

## Payment tracking

Payments are a ledger, not a status flag: entries are appended, never edited. An entry with a bank
reference books as `Confirmed`; without one it stays `Pending reconciliation` and does **not** count
as collected money until a manager reconciles it. Reversals are partner-only correcting entries
(negative amount, `reversal_of` link, reason required) — a payment is never silently modified.
Balance ceiling checks count every non-reversed entry including pending ones, inside the insert
transaction, so over-settlement is impossible. Duplicate reference+amount on the same invoice is
rejected as a retry (409).

## Credit notes

Partner-issued against issued invoices with a reason ≥ 5 chars and a ceiling of
`total − confirmed paid − already credited`. Taxable/GST parts are proportional to the invoice. The
credit reduces the balance; it never counts as a payment.

## Where the UI is

- **Invoices page** ([components/views/invoices.tsx](../../components/views/invoices.tsx)) — list
  with lifecycle and payment status, draft editor, approval actions, issue, payments panel, credit
  notes, event history, PDF download/token, WhatsApp delivery status.
- **Settings → Billing** ([components/views/settings.tsx](../../components/views/settings.tsx)) —
  firm settings and tax treatments.
- **Automation page** — billing backlog (completed unbilled cycles and their value).
