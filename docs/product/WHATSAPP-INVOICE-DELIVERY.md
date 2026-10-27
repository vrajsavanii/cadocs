# WhatsApp invoice delivery (Prompt 10)

## When an invoice is delivered

Delivery is an **explicit, human-triggered action**, never an automatic side effect of issuing:

- `deliverIssuedInvoice(invoiceId, actor)` requires the invoice to be `issued`, the firm setting
  `deliver_on_issue` to be on, the client to have an explicit `whatsapp_opt_in` **and** a phone
  number, and the actor to hold the `deliver` invoice permission. Any failed gate → `skipped`.
- The automation role and users below manager can never fire delivery (`deliver` permission is
  manager+; the billing engine itself has no `deliver` power).
- Outbox rules from Prompt 8 still apply: communication eligibility, quiet hours, template flow,
  explicit fallbacks. Template params: contact name, invoice number, `Balance ₹x`, due date.

## Idempotency

One delivery per invoice: `automation_key = invoice-issued:{invoice_id}`. A second click finds the
existing outbox record and re-emits its status without re-sending (`DELIVERY_SKIPPED` event).

## What a send result means

| `deliverIssuedInvoice` result | Meaning                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `sent`                        | Cloud API **accepted the template send** — not client-confirmed delivery, not proof of payment |
| `queued`                      | In the outbox awaiting send                                     |
| `failed`                      | Provider refused — logged in the outbox `error` field            |
| `skipped`                     | A gate refused (lifecycle, opt-in, permission, settings)         |

The invoice event history (`DELIVERY_QUEUED`) stores exactly this wording — provider acceptance is
 never conflated with delivery or payment.

## PDF links to the client

There are **no permanent public links**. The invoice PDF is stored privately
(`docs/invoices/{client_id}/{invoice_id}/pdf-v{n}.pdf`, the only key space the storage layer
accepts). `GET /api/invoices/{id}/pdf` serves it to:

- signed-in staff with the `view` permission through the session, or
- an external recipient presenting a **signed, short-lived download token bound to this exact
  invoice id** (`invoicePdfToken`, 1 h – 14 days TTL, default 72 h) — the same scoping as client
  document sharing. The token grants nothing else and expires server-side.

Response headers are `private, no-store`; the token never triggers storage writes.
