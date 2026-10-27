# Reporting & Analytics Test Plan (Prompt 13)

Status: **passing**. 11 automated checks in `tests/reports.test.ts`; full suite (13 files / 109 tests) and `tsc --noEmit` green; `npm run build` succeeds with `/reports` and `/api/reports` as dynamic server-rendered routes.

## Environment

Every test runs against an **isolated temp SQLite database** (`tests/helpers/setup.ts` → `withIsolatedDataDir()`): production-mode timing, demo seed disabled, the developer's own `.data` directory never touched.

## Seeded workload

Deterministic, mounted on three clients (two Active, one Exited) and three staff (partner, manager, article):

- **CMP1** — GST return, due 10 days ago, open (overdue).
- **CMP2** — tax audit at sign-off with an open progress-blocking `task_blockers` row.
- **CMP3** — annual ITR filed **on time** (filed date ≤ internal target) with recorded filing evidence.
- **CMP4** — annual ITR filed **late** but with filing evidence.
- **CMP5** — TDS return flagged `Filed` **without** filing evidence.
- **CMP6** — GST return in review with a task-event ledger: submit → rejection back to preparation → resubmit (yesterday).
- Two document requests (one open and at reminder cap, one cleared), four invoices (paid, partial, unpaid overdue, cancelled), two recorded payments, three messages (sent/failed/manual), two timesheets, one failed automation run.

All dates are computed relative to `todayISO()` so the suite never goes stale.

## Assertions

Filter parsing
- Valid filters parse unchanged; unknown keys are dropped.
- Malformed dates and a malformed FY produce named reasons without throwing; a reversed `from`/`to` range is rejected.

Partner-scope pack
- Overview counts (open / overdue / completed-with-evidence / filed-without-evidence / unassigned) match the seed exactly; clients are deduplicated by `client_id`; onboarding window counts only clients created inside the last 30 days.
- Deadline buckets: completed_on_time vs completed_late separated by the internal target date; `Filed` without evidence lands in `awaiting_filing_evidence`; overdue day-count math asserted.
- Review analytics: days-in-review measured from the latest recorded entry into review; two review rounds; one rejection back to preparation detected (correction loop).
- Collections: paise-canonical totals (₹4,720 outstanding), ageing buckets (1–30 and 31–60), cancelled invoices excluded, overdue register sorted by days late.
- Annual progress: a `Filed` flag without evidence never counts; audit engaged-but-not-filed does not count as completed.
- Attention queue contains overdue filing, blocked engagement, overdue invoice, failed job and failed communication entries, all with drill-down links.
- Filters narrow rows while totals stay arithmetically consistent.

Tenant isolation
- For an article viewer the pack reports `scope: "personal"` and **omits** (not zeroes) collections, staff tables and billing; client-delivery rows carry `null` money fields.

Money canonicalisation
- Legacy `REAL` invoices without paise columns are round-tripped exactly (118 → 11800 paise; 58.655 → 5866 with a 5934-paise balance).

## Not covered by automation (manual)

Visual layout of the ten-tab dashboard and the filter bar; browser rendering of the pack; `/api/reports` HTTP behaviour behind a live session (the same `parseReportFilters` → `getUnifiedReports` path is tested at module level).
