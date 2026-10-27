# Compliance Calendar & Engagement Workboard

**Status:** implemented (Prompt 5 extends the Prompt 1–2 calendar).

## Surfaces

| Route | Contents |
|---|---|
| `/compliance` | the compliance calendar: list view and month grid over every engagement |
| `/workflow` | the staff workboard: engagements grouped by workflow stage, with the detail drawer |

Both render server-side from `lib/engagement-queries.ts` (`queryEngagements`) and
`lib/workflow.ts` (`buildWorkflow`), so an article assistant only ever receives the
engagements on their own desk, and no page ships the whole table to the browser.

## Calendar (`/compliance`, [components/views/compliance.tsx](../../components/views/compliance.tsx))

- **List view** with quick filters: All · Overdue · Due 7 days · Pending · Filed, plus
  free-text search and dropdown filters for service line, preparer/reviewer, assignment
  state and statutory-deadline state.
- **Month grid** (42-cell, prev/next month) showing each day's engagements; every cell
  links to the engagement detail.
- **Deadline labelling** uses `dueDateSummary` from [lib/due-dates.ts](../../lib/due-dates.ts):
  a verified rule shows "Statutory due date"; everything else shows
  "Internal target (statutory date unverified)". `statutory_unknown` is rendered as
  "No deadline" rather than an invented date.
- **Generation preview** — a manager or partner opens the preview modal, picks a
  from/to window, calls `POST /api/engagements/preview` and reviews each candidate
  (`create` / `exists` / `skip` / `invalid` plus warnings) before confirming. Committing
  calls `POST /api/engagements/generate` with `confirmed: true`. The preview is advisory;
  the server re-validates everything at commit.
- **Manual engagement** — the existing "add task" modal still creates a single manual
  engagement (`generation_source = 'manual'`); it never bulk-generates.
- Blocked states are surfaced explicitly: "Documents pending", "Assignment missing",
  "Awaiting review", "Filing evidence missing".

## Workboard (`/workflow`, [components/views/workflow.tsx](../../components/views/workflow.tsx))

Stages: **Documents → Preparation → Review → Portal filing → CA sign-off → Done**.

- Engagements grouped by current stage with counts, filtered by mine/everything the
  role can see.
- The detail drawer shows period (with FY/AY), internal target vs statutory date and
  which rule produced it, assignments, stage history, status history, and the actions
  the caller's role is allowed to perform (`checkTransition` decides server-side).
- Stage advancement is gated: review cannot be skipped, sign-off requires filing
  evidence, and filing evidence requires a reference. Articles may advance their own
  tasks; statutory/internal date overrides are manager+ (`overrideStatutoryDate`,
  `overrideInternalTarget` are partner/manager-only in `lib/workflow.ts`).

## What the calendar never does

- It never shows an unverified statutory deadline as a legal deadline.
- It never marks a task filed on stage completion — only recorded filing evidence does.
- It never sends reminders on its own; the reminder button queues an intent for the
  messaging phase, and no WhatsApp message is sent from these screens.

## Data source

`GET /api/engagements` supports `page`, `per_page`, `client_id`, `service_code`,
`status`, `preparer`, `reviewer`, `mine`, `overdue`, `due_within`, `statutory` and
`q` filters, sorted by the effective deadline. Counts come from `engagementCounts`.