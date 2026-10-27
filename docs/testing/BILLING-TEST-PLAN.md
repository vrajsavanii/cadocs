# Billing test plan (Prompt 10)

Implementation lives in [tests/billing.test.ts](../../tests/billing.test.ts) (vitest, fresh temp
data directory per run via `CA_DATA_DIR`). Run with `npx vitest run tests/billing.test.ts`; the
whole suite (`npx vitest run`) must stay green alongside it, plus `npx tsc --noEmit`.

## Coverage by risk

### Numbering & sequencing
- Numbers allocated only at issue, `per_fy` format `{prefix}/FY/NNNN` derived from invoice date.
- Legacy-occupied slots skipped; a credit-note sequence reserved for one invoice is reusable.
- Two sequential issues never collide (unique index + in-transaction scan).

### Draft creation & idempotency
- Line validation: empty description, zero price, bad quantity, discount > line, unknown treatment.
- Invoice requires ≥ 1 line; billing-disabled refusal; unknown client 404.
- `billing_event_key` idempotency: same key twice returns the same invoice (`created: false`),
  including the automation-without-key refusal and a raced duplicate key degrading to a no-op.
- Automation role cannot create unkeyed drafts or perform privileged actions.

### Lifecycle & approval
- Approval requirement per settings; submit → approve requires a *different* person; reject needs a
  reason and returns the draft; issue before approval refused; void/cancel rules per lifecycle.
- Issue freezes `issue_snapshot`; issuance with unconfigured GST rate refused; issue validation
  problems surfaced client-side via `validate`.

### GST correctness
- Intra-state split CGST+SGST (odd paise to SGST) vs inter-state IGST for same/different state
  codes; `TAX-NONE` zero-tax; unconfigured rate blocks issuance.

### Payments
- Guards: future date, pre-invoice date, zero amount, over-balance, article-role refusal.
- Reference-less entry → `Pending reconciliation`, reserves balance but not collected money;
  reconcile moves it into `paid_paise`; statuses (`Pending`/`Partially Paid`/`Paid`) ledger-derived.
- Duplicate reference+amount rejected; payment reversal is partner-only, reason-required, is a
  separate negative entry (`reversal_of`), and aggregates recompute; reversal ceiling respected.

### Credit notes
- Reason/amount validation, ceiling `total − confirmed paid − credited`, proportional
  taxable/GST split, own NC number sequence, never counted as payment.

### PDF & download tokens
- PDF only after issue; snapshot-based with persisted checksum/version; missing-object recovery
  bumps version; token TTL is bounded; `invoiceTokenHours` decodes the TTL; token binds to one
  invoice id only.

### Delivery gating
- Skips unless issued + deliver-on-issue + client opt-in + phone + `deliver` permission; one
  delivery per invoice (idempotent `automation_key`); result semantics sent/queued/failed/skipped.

### Security
- Permission matrix across admin/partner/manager/article/automation for every mutation.
- Receivables aggregate math (aging buckets, outstanding/overdue totals, balance math on legacy and
  new rows).

## Conventions
- Helpers create firms/clients/services through the real onboarding path, never direct SQL.
- Every run asserts rate assumptions explicitly (no test hard-codes GST math that the code could
  silently absorb).
- No assertions rely on wall-clock transitions other than `todayISO()` guards already tested.
