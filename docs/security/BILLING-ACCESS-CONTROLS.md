# Billing access controls (Prompt 10)

All enforcement is server-side in [lib/invoicing.ts](../../lib/invoicing.ts)
(`assertInvoicePermission`); routes never decide authority themselves.

## Permission matrix

| Capability (`InvoicePermission`) | Admin | Partner | Manager | Article/Staff | Automation |
| -------------------------------- | ----- | ------- | ------- | ------------- | ---------- |
| `view` (invoices, PDF, detail)   | ✅    | ✅      | ✅      | ✅            | ❌         |
| `create-draft` / `edit-draft`    | ✅    | ✅      | ✅      | ❌            | keyed only* |
| `approve`                        | ✅    | ✅      | —       | ❌            | ❌         |
| `issue`                          | ✅    | ✅      | ✅      | ❌            | ❌         |
| `cancel` (issued)                | ✅    | ✅      | ❌      | ❌            | ❌         |
| `payments` (record / reconcile)  | ✅    | ✅      | ✅      | ❌            | ❌         |
| `payment-reversal`               | ✅    | ✅      | ❌      | ❌            | ❌         |
| `credit-note`                    | ✅    | ✅      | ❌      | ❌            | ❌         |
| `settings` (billing + tax rates) | ✅    | ✅      | ❌      | ❌            | ❌         |
| `deliver` (WhatsApp invoice)     | ✅    | ✅      | ✅      | ❌            | ❌         |
| `receivables` (report)           | ✅    | ✅      | ✅      | ❌            | ❌         |

\* Role `automation` may only call `createDraftInvoice` **with a `billing_event_key`** and
`auto_generated`; it never gains issue, payment, cancel or delivery powers.
Unsigned-in callers are refused at the route (`getSessionUser` gate on every billing endpoint).

## Additional gates

- **Self-approval refused**: the approver must differ from the creator (approval flow requires
  a different person; `approve` same-session returns 409).
- **Lifecycle preconditions** — every transition validates its source state server-side; stale
  concurrent writers get the `changes === 0` re-check inside the transaction (409, refreshable).
- **Firm isolation** — tenant isolation is enforced by the existing per-firm data directory and
  session binding; no billing query takes a firm/client identifier from the request that could
  cross tenants (client linkage is validated server-side before any invoice per-client lookup).
- **Settings secrecy** — `GET /api/billing` returns bank details and tax rates only for users with
  the `settings` permission.
- **Payment truth** — money state changes are possible only through the ledger endpoints
  (`payments`, `payments/{id}` with reversal/reconcile actions); no route mutates
  `paid_paise`/`status` directly. Before issue finalisation, invoices stay `Pending` regardless of
  payment records; only ledger aggregates move an invoice to Paid.
- **PDF access** — session + `view`, or a signed single-invoice download token; no permanent public
  URL, `no-store` headers, external tokens can never trigger storage writes or recovery renders.
- **Audit** — every mutation writes both an `invoice_events` row (append-only, trigger-protected)
  and a firm `audit_log` entry with actor, action and entity.

## AI layer

Billing tools in the app are read-only (`list_overdue_invoices`, receivable snapshots); any
dunning/kick action still flows through approval-gated write actions, and the AI panel can never
record payments, issue invoices or change tax rates.
