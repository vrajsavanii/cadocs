# Prompt 13 — Reports, Analytics, Management Dashboards & Business Intelligence

Implementation status: **built and tested** (`tests/reports.test.ts` — 11 tests; full vitest suite 13 files / 109 tests and `tsc --noEmit` green at the time of this report).

## What was audited before building

Existing reporting surfaces were inspected rather than replaced:

- Legacy reports view: `getReports()` in `lib/db.ts` → `ReportData` → `components/views/reports.tsx` plus `/api/export` CSV registers. That finance/utilisation screen remains untouched and still works.
- Source-of-truth models reused: `compliance`, `task_events`, `documents`, `document_requests`, `invoices` (paise-canonical `total_paise`/`paid_paise` from Prompt 10), `payments`, `messages`, `timesheets`, `automation_runs`, `task_blockers`, `clients`, `users`.
- Enrichment logic reused verbatim: `toWorkflowTask` (workflow stage/deadline state/assignment), `billingBacklog`, `fyForDate`, `dayDiff`, `deadlineState`.
- No new data model was introduced; no sample or extrapolated numbers are produced anywhere.

## Architecture

`lib/reports.ts` — single server-side layer:

- `parseReportFilters(raw)` validates every filter server-side (ISO `from`/`to` dates ordered correctly, `fy`/`assessment_year` in `YYYY-YY` form, length caps). Unknown keys are ignored; invalid values are reported in `invalid[]` and never fail the whole request.
- `getUnifiedReports(filters, viewer)` builds the ten-section pack. **Scope is server-enforced:** for viewers whose role is not partner/manager (`scope: "personal"`), the financial and team sections (`collections`, `staff`, `overview.billing`, duplicated performer counts) are omitted entirely — never zeroed — and client-delivery money fields are `null`. The API route `(app/api/reports/route.ts)` passes the session user; anonymous callers get the personal pack.
- Every section computation is a pure builder (`buildOverview`, `buildDeadlines`, `buildClientDelivery`, `buildDocuments`, `buildStaffWorkload`, `buildReviewBottlenecks`, `buildCollections`, `buildAnnualProgress`, `buildCommunications`, `buildExceptions`) — unit-tested directly.
- Money: `invoicePaise()` prefers the integer paise columns and falls back to rounding legacy `REAL` amounts; balances are displayed in rupees but computed in paise throughout.

## The ten sections

1. **Overview** — clients (deduplicated by `client_id`; registrations/engagements never multiply counts), engagement pipeline (due-soon/today/overdue, awaiting documents/preparation/review/correction, filed-with vs without filing evidence, blocked, unassigned), document + communication pulse, billing pulse (outstanding/overdue/unbilled backlog).
2. **Deadlines** — bucket classification incl. `completed_on_time` vs `completed_late` (judged against the internal target, never an invented statutory date), `awaiting_filing_evidence` for `Filed` rows without a recorded reference/integration confirmation, 400-row cap with `rows_capped` disclosure, per-service and per-staff breakdowns.
3. **Client delivery** — one row per client: services, open engagements, current stage, preparer/reviewer, outstanding requirements, next deadline, open blockers, money only when authorized.
4. **Documents** — open/cleared/rate, reminder-cap exhaustion, average days-to-clear from `created_at`→`cleared_at`, oldest open requests.
5. **Staff** — open/overdue/due-soon volume, their review queue, completions in window, timesheet hours (billable split). Supervisory roles only.
6. **Review bottlenecks** — days-in-review from the latest recorded `to_stage='review'` task event (fallback to `stage_updated_at`), review rounds, and the correction loop counter (`review → preparation` events).
7. **Collections** — billed vs collected (invoice issue dates vs recorded payment ledger dates), ageing buckets (not due/1–30/31–60/61–90/90+), 6-month trend, overdue register sorted by days late. Cancelled invoices never pollute totals.
8. **Annual ITR / tax-audit progress** — per assessment year: ITR totals, filed, filing-evidence-backed counts, audit totals and evidence-backed completions. A `Filed` flag alone never counts as completed.
9. **Communications** — status/kind distributions over the retained message window (storage-capped; the basis note says totals are floors for older periods) plus recent provider failures with errors.
10. **Operational exceptions** — the management-attention queue: critical overdue work, unassigned engagements, long-pending reviews, blocked engagements, overdue invoices, failed automation runs, failed messages, partner-approval backlog. Every item carries a reason and a drill-down `href`.

## UI

`app/reports/page.tsx` (server component, `force-dynamic`, session-aware) → `components/views/reports.tsx`:

- Ten tabs (Overview / Deadlines / Clients / Documents / Staff / Reviews / Collections / Comms / ITR-Audit / Attention) with URL-persisted section and filter state.
- Global filter bar (client, FY, engagement, service, staff/preparer/reviewer, invoice/payment status, from/to range) that writes query params; the server re-validates everything.
- Malformed filters degrade to the reports pack plus an inline `filter_warnings` banner — never a hard failure.
- Drill-downs link into `/clients?client=…` and `/workflow?task=…`; a JSON button exposes the same pack via `/api/reports`; legacy CSV registers remain linked.
- A "How these numbers are built" card lists the pack's per-section basis notes (deadline basis, completion-evidence basis, billing basis, communication-window basis, scope statement).
- Dormant tables render `EmptyState`, not fake zeros; responsive from mobile (stacked KPI grids) to desktop.

## Honest limitations (disclosed in the pack itself)

- Message-history trends are floors, not complete histories (retained-row cap).
- Historical status trends over time are not computed where the record only stores current state; the pack shows current-record metrics only.
- Review dwell falls back to `stage_updated_at` when task events are absent (labelled as such in the review panel).
- `assessment_year` is `not recorded` for legacy rows that pre-date the period model; those group separately rather than being guessed.
