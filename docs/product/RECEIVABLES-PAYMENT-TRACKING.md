# Receivables & payment tracking (Prompt 10)

## The payment ledger

`payments` is append-only bookkeeping. Allowed modes: UPI, Bank Transfer, Cash, Cheque, Card,
Other. Entry rules enforced in [lib/invoicing.ts](../../lib/invoicing.ts) (`recordPaymentEntry`):

1. Only an **issued** invoice can receive payments (drafts refuse).
2. Amount must be > 0, payment date within `[invoice_date, today]`.
3. Duplicate `(invoice, reference, amount)` on a non-reversed entry is rejected as a retry (409).
4. Balance ceiling: the entry is inserted and the fresh ledger sum compared against
   `total − credit` **inside one transaction** — pending (unreconciled) entries reserve balance too.

### Statuses

| Entry status            | Effect on invoice                                       |
| ----------------------- | -------------------------------------------------------- |
| `Confirmed`             | Counts toward collected money immediately                |
| `Pending reconciliation`| Reserves balance but is NOT collected money until a manager reconciles |
| `Reversed`              | Ignored by aggregates; a negative `reversal_of` entry books the correction |

An invoice shows `Paid` only when collected money (confirmed entries, net of reversals) covers
`total − credit`; otherwise `Partially Paid` / `Pending`. Reconcile with `reconcilePaymentEntry`
(manager+, audit-logged); reverse with `reversePaymentEntry` (partner-only, reason ≥ 5 chars);
both recorded as invoice events. Automation and clients can never touch these endpoints.

## Dunning (reminder rules)

Nothing is auto-sent for payments. Overdue collection runs through the Prompt 7/8 reminder rules:

- `dunning` rule (`Recover overdue fees`) picks invoices past their due date with a positive balance
  and sends WhatsApp/email reminder body templates carrying invoice number, balance and due date;
  the firm can configure `dunning_days`, cap sequences and channels.
- `escalate_overdue` informs the partner when filings/invoices are long overdue.
- The whole sweep is duplicate-guarded (`automation_key`) — a retry never double-sends.

A WhatsApp delivery or reminder receipt is **never** proof of payment. Only `Confirmed` ledger
entries move money.

## Receivables report

`receivablesReport()` ([lib/invoicing.ts](../../lib/invoicing.ts)) with filters (client, FY, service)
returns:

- Ageing buckets from firm settings (default Not yet due / 1–30 / 31–60 / 61–90 / 90+ days overdue)
  with invoice count and outstanding paise each.
- Per-invoice rows: number, client, dates, total/credit/collected in rupees (legacy columns) plus
  canonical paise, balance and days-overdue.
- Totals: issued outstanding and issued overdue (`outstandingPaise`, `overduePaise`).

Exposed at `GET /api/billing/receivables` and used by the dashboards/AI layer
(`list_overdue_invoices` read tool, dunning bulk tool, daily brief).
