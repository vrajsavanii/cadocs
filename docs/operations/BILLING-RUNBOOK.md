# Billing runbook (Prompt 10)

Day-to-day procedures for running billing in production. Architecture background:
[BILLING-DATA-MODEL.md](../architecture/BILLING-DATA-MODEL.md); access rules:
[BILLING-ACCESS-CONTROLS.md](../security/BILLING-ACCESS-CONTROLS.md).

## First-time setup (partner)

1. **Settings → Billing**: enable billing, set legal name, address, PAN, GSTIN, invoice prefix,
   numbering policy, payment terms (days), payment instructions / bank details (these appear on
   every issued invoice via the issue snapshot), approval requirements, deliver-on-issue, ageing
   buckets.
2. **Tax treatments**: configure rates (basis points) for every GST rate the firm actually charges.
   Ship with only `TAX-NONE` and `TAX-GST-UNCONFIGURED`; issuance of invoices on unconfigured rates
   is blocked until configured — this is deliberate.
3. Set the auto-billing treatment used by the engine for client-service fees.

## Routine

- **Drafts**: created manually (Invoices → New invoice) or automatically when a filing cycle is
  marked Done on an `auto_invoice` service (engine draft, approval always required, no number and no
  messages at creation).
- **Approve & issue**: manager/partner submits/approves (different people), then issues. Issuing
  stamps the number and freezes amounts. After issue, corrections are credit notes + reversals only.
- **Deliver by WhatsApp**: click Deliver on an issued invoice (manager+). Gated by client opt-in and
  firm deliver-on-issue; delivery is idempotent.
- **Collections**: record payments with bank references (auto-confirmed) or without (pending
  reconciliation → manager reconciles). Partner reversals for mistakes with a reason.
- **Cycles end of week**: check the Receivables view (aging buckets) and the AI brief's
  "money at risk" section; dunning reminder rules run on the cron sweep.

## Recovery procedures

- **PDF missing/failed generation** — `ensureInvoicePdf` re-renders from the frozen issue snapshot
  and bumps `pdf_version`; triggered lazily on the next authenticated view. External token links
  never trigger writes; have a staff member open the invoice once.
- **WhatsApp delivery failed** — outbox row carries the provider error (`error` field). Fix number
  (opt-in, phone, template status) and press Deliver again; the `automation_key` check allows the
  retry (failed sends are re-queued, successful ones are not re-sent).
- **Duplicate payment recorded by mistake** — reverse it (partner, reason). Never edit rows.
- **Job retries** — draft creation and delivery are idempotent by key; a retried cron sweep cannot
  duplicate invoices or messages. Investigate repeated `Already invoiced` reasons, not data damage.
- **Billing misconfiguration** — settings/treatment changes are audit-logged with actor; past
  invoices keep their issue snapshot, so retroactive rate changes never touch issued invoices.

## Data & compliance notes

- Money is stored as integer paise; the REAL legacy columns are display-only.
- Invoice event history is append-only at the database level (triggers abort updates/deletes).
- GST rates are not invented anywhere in the code; issuance blocks on unconfigured treatments.
- Never treat a WhatsApp `sent` status as delivery or payment — Cloud-API acceptance only.
- Cancel an issued invoice (partner, reason) rather than deleting; history must survive.
