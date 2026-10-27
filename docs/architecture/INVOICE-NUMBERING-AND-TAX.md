# Invoice numbering & GST computation (Prompt 10)

## Number allocation

`allocateNumber(kind, dateISO, settings, usedNumbers)` in [lib/invoicing.ts](../../lib/invoicing.ts):

- Format `{prefix}/{fy}/{seq:NNNN}` when `numbering_policy = per_fy` (fiscal year of the **invoice
  date**: starts 1 April), or `{prefix}/{seq:NNNN}` when sequential.
- Prefixes are firm-configurable (`invoice_prefix` default `NV`, `credit_note_prefix` default `NC`).
- The next sequence is **never derived from a row count**: the allocator scans numeric suffixes
  already used under the same stem and moves one past the highest, *skipping* slots that legacy rows
  occupy, so historical numbers are preserved and never silently renumbered.
- Allocation is a pure function of the used-number set; callers collect that set inside the open
  write transaction (`BEGIN IMMEDIATE`), so two issuers cannot race. Unique index on
  `invoices(invoice_number)` / `credit_notes(number)` is the final guard; exhausting 1,000,000
  sequences is a 409, not a wraparound.

The human number exists only from issuance onwards — drafts are identified by `INV…` ids plus
`billing_event_key`, so draft churn never burns numbers.

## Issue snapshot

At issue, in the same transaction, the line items, firm identity block (legal name, address, PAN,
GSTIN, bank details, payment instructions, footer), client identity block and computed totals are
frozen into `issue_snapshot`. Later client/firm/settings edits do **not** alter an issued invoice;
the PDF renders from the snapshot. Re-issuance ("issue cannot be restamped") is refused.

## GST computation (`computeLines`)

Per line: `taxable = quantity × unit_price − discount` (all in paise, integers end to end;
UI inputs are rupees converted losslessly by the API layer).

- Tax comes **only** from the line's `tax_treatments` row. `kind = none` → no tax. `kind = gst` with
  `rate_bp = NULL` → zero tax at draft time, and `validateInvoiceForIssue` refuses issuance ("GST
  rate is not yet configured"). No code path invents 18%/12% defaults.
- Place of supply: firm GSTIN state-code prefix vs the client's `gst_state_code`.
  - Same state → CGST = ⌊tax/2⌋, SGST = tax − CGST (odd paise to SGST), IGST = 0.
  - Different/absent state or no firm GSTIN → IGST = tax, CGST = SGST = 0.
- Rounding is per line, `Math.round` on the GST amount, once — never on a float intermediate.
- Missing treatment id, inactive treatment, discount > line amount, qty/entity guards all throw
  problem-level errors at draft time.

Credit notes re-apportion the credited total proportionally between taxable and GST parts rather
than re-computing rates.
