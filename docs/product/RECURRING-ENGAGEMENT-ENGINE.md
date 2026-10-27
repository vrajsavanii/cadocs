# Recurring Engagement & Compliance Engine

**Status:** implemented (Prompt 5). This document describes the behaviour that exists in
the code today, not a target design.

## Purpose

Turn the services configured during client onboarding (Prompt 4) into period-specific
compliance engagements — one row of work per client, service, registration and period —
with staff assignments, an internal target date, and (only when a partner has verified a
rule) a statutory due date.

## Architecture and data flow

```
client_services (active, in window)
        │
        ▼
lib/periods.ts ────── period boundaries, FY/AY, window enumeration
        │
        ▼
lib/due-dates.ts ──── internal target date; statutory date only from a verified rule
        │
        ▼
lib/engagement-engine.ts ── preview (plan) → generate (idempotent commit) → run record
        │
        ├──▶ compliance rows (unique per client+service+period+registration)
        ├──▶ compliance_status_history (append-only)
        └──▶ engagement_generation_runs (observable outcomes)
        │
lib/engagement-jobs.ts ── daily cron → jobs table (logical key) → same engine
        │
lib/engagement-queries.ts / lib/workflow.ts ── role-aware list, stages, evidence
        │
UI: /compliance (calendar) · /workflow (list + detail)
```

## What drives generation

Only `client_services` rows that are:

- status **Active** (paused, cancelled and completed services are skipped),
- inside their `start_date`/`end_date` window,
- attached to a client that is not paused,
- for GST services, backed by an active GST registration for the applicable state.

Each service generates only its own work. A client with GST services activated never
receives ITR, TDS, audit or ROC engagements unless those services are separately
configured and activated. Unknown or catalog-less services are reported as `invalid`
in the run detail rather than silently generating something plausible.

## Recurrence supported

`monthly`, `quarterly`, `half_yearly`, `annual`, `one_time` (`FREQUENCIES` in
[lib/periods.ts](../../lib/periods.ts)). Period boundaries are computed from the service
frequency anchored on the period end (for example, the month or quarter that just
closed), with financial-year (Apr 1 – Mar 31) and assessment-year arithmetic for ITR
work. `enumeratePeriods` walks a bounded window and never invents a period outside the
service's effective dates.

## Idempotency

Three independent layers, in order:

1. **Plan first, then insert.** `previewGeneration` classifies every candidate as
   `create` / `exists` / `skip` / `invalid`; `generateEngagements` re-checks existence at
   commit time.
2. **Database uniqueness.** `idx_compliance_cycle` on
   `compliance(client_id, service_code, period, IFNULL(registration_id,''))` — the last
   insert wins, duplicates are impossible at the storage layer.
3. **Job logical key.** The daily sweep enqueues `jobs(logical_key = 'recurrence:<date>')`,
   so a cron that fires twice is a no-op.

Verified over HTTP against the production build: run 1 created 3 engagements (31
processed, 28 skipped), run 2 created 0 (31 processed, 8 already existing), and a third
cron invocation returned `queued:false` with the same `job_id`. Re-running generation
never resets stage, status, filing evidence or assignments on existing rows.

## Due dates (never fabricated)

- Every shipped rule starts as `verification_status = 'unverified'` and supplies an
  **internal target date** only.
- `statutory_due_date` is populated only when a rule carries a partner-recorded
  authority reference and `verification_status = 'verified'`, inside its effective
  window. Conflicting verified rules resolve to no statutory date plus a warning.
- UI/API labelling: "Internal target (statutory date unverified)" until then.
- See [DUE-DATE-RULES.md](DUE-DATE-RULES.md).

## Filing is evidence, not a checkbox

Completing a workflow stage never marks a return filed. `recordFilingEvidence` requires a
filing reference (acknowledgement number etc.), stamps `filing_recorded_at`,
`filing_recorded_by` and leaves `filing_confirmed_by_integration = 0` because no
government integration exists. Without a reference the API refuses with a field error.

## Staff work items

Every generated engagement carries preparer, reviewer, manager and authorised-CA
assignments resolved from the service configuration (not re-derived from the client's
relationship manager). Unassigned work appears as an explicit exception in the run
detail and on the engagement; cross-desk assignment attempts are rejected by
`assertAssignable`. Articles may only PATCH their own workflow transitions.

## What this phase deliberately does not do

- No WhatsApp or email is sent by any generation path.
- No invoice is generated.
- No document request is issued beyond what Prompt 4 activation already created.
- No statutory date is claimed as legally verified without a partner's recorded rule.

## API surface

| Endpoint | Method | Who | Purpose |
|---|---|---|---|
| `/api/engagements` | GET | any signed-in | filtered, paginated list (`queryEngagements`) |
| `/api/engagements/[id]` | GET | any signed-in | detail + status history + stage info |
| `/api/engagements/[id]` | PATCH | any signed-in (route enforces per action) | advance stage, assign, record filing evidence, overrides |
| `/api/engagements/preview` | POST | manager, partner | dry-run plan for a window/client/service |
| `/api/engagements/generate` | POST | manager, partner, `confirmed: true` | commit a generation run |
| `/api/engagements/runs` | GET | any signed-in | recent generation runs |
| `/api/due-date-rules` | GET / POST | GET all signed-in / POST partner | rules list, new verified version |
| `/api/cron/recurrence` | GET | `CRON_SECRET` or Vercel Cron | daily sweep |
| `/api/workflow`, `/api/workflow/[id]` | GET/PATCH | per role | board and workflow actions |

Role checks happen in two places: the edge policy in [lib/auth.ts](../../lib/auth.ts)
(`canAccess`, which blocks articles from generation endpoints and limits them to
`PATCH` on engagements) and the handlers themselves.

## Known limitations

- The installation is **single-firm** (no `firm_id`); isolation is role- and
  session-based, per [CLIENT-AND-REGISTRATION-MODEL.md](../architecture/CLIENT-AND-REGISTRATION-MODEL.md).
- Half-yearly and custom recurrences exist in the type system but the shipped catalogue
  only configures monthly/quarterly/annual/one_time services.
- There is no live government filing integration; `filing_confirmed_by_integration`
  stays 0.