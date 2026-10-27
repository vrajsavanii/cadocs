# Engagement Data Model

**Status:** implemented (Prompt 5, migration 4 in [lib/db.ts](../../lib/db.ts)).
This reflects the schema that exists in code, including the single-firm limitation
documented in [CLIENT-AND-REGISTRATION-MODEL.md](CLIENT-AND-REGISTRATION-MODEL.md).

## Design choice: extend, don't replace

The existing `compliance` table was already the firm's unit of statutory work and is
referenced by `invoices.compliance_id`, `documents.compliance_id`, workflow stages and
the calendar. Prompt 5 **extends** it with an explicit period/due/filing model instead
of creating a parallel `engagements` table, so every existing relationship, invoice and
filed record is preserved byte-for-byte.

## Core entity: `compliance` (one row = one engagement)

Identity: `compliance_id` (e.g. `COMP-048`). Prompt 4 added registration-awareness
(`registration_id`, `service_id`, `service_code`) and the cycle uniqueness index.
Migration 4 added:

| Column group | Columns |
|---|---|
| Period | `period_type`, `period_start`, `period_end`, `assessment_year` (+ existing `period`, `fy`) |
| Deadlines | `internal_target_date`, `statutory_due_date`, `due_rule_id`, `due_rule_version`, `due_date_source`, `due_date_verified`, `statutory_rule_status` |
| Provenance | `generation_source` (`automatic` / `manual` / `migration`), `generated_at` |
| Filing evidence | `filing_recorded_at`, `filing_reference`, `filing_recorded_by`, `filing_confirmed_by_integration` (always 0 — no integration), `filing_notes` |

Existing columns that remain authoritative: `status` (Pending / In Progress / Filed …),
`stage`, `assigned_to`, `due_date` (legacy display date), `filed_date`, `ack_number`,
`notes`, `client_id`, `service_id`, `service_code`, `registration_id`.

### Business uniqueness

```sql
CREATE UNIQUE INDEX idx_compliance_cycle
  ON compliance(client_id, service_code, period, IFNULL(registration_id, ''))
  WHERE service_code IS NOT NULL AND service_code <> '';
```

Firm + client + service + registration + period is the engagement's business identity
(there is no `firm_id`: the installation is single-firm, the data directory is the
boundary). The partial index keeps pre-catalogue legacy rows — which have no
`service_code` — unconstrained, so the migration cannot fail on historical data.

## Service configuration: `client_services`

Already carried firm/client/service/registration/status/dates/frequency/assignments/
checklist from Prompt 4. Migration 4 added `priority` (Low/Normal/High, default Normal)
and `escalation_days` (default 2). Service-level due-date rules live in `due_date_rules`,
referenced from engagements by `due_rule_id` rather than duplicated per service.

## `due_date_rules`

Immutable, versioned rules: `(service_code, frequency, version)` is unique; effective
windows (`effective_from`/`effective_to`) decide which version applies to a period;
`verification_status` + `authority_reference` gate whether a statutory date may be
emitted. See [DUE-DATE-RULES.md](../product/DUE-DATE-RULES.md).

## `compliance_status_history` (append-only)

`(history_id, compliance_id, from_status, to_status, from_stage, to_stage, actor, role,
reason, created_at)`. Enforced append-only by SQLite triggers — any `UPDATE` or
`DELETE` raises `compliance status history is append-only`. Corrections therefore have
to be a *new* row with a reason; ordinary users cannot rewrite history. Migration 4
seeded a baseline `HIST-M4-<id>` row per engagement so pre-existing work has a
starting point.

## `engagement_generation_runs`

`(run_id, trigger, actor, window_from, window_to, client_id, service_id, status,
processed, created, skipped, failed, warnings, detail, started_at, finished_at)` —
one row per preview/commit/cron run, `detail` holding the full plan JSON
(per-item action, reason, warnings). This is the audit/observability trail the
generation UI and `/api/engagements/runs` read.

## Related entities (unchanged)

- `client_registrations` — GST registrations; engagements reference them by
  `registration_id` so two GSTINs produce two independent engagement streams.
- `jobs` — durable queue; `logical_key = 'recurrence:<date>'` makes the daily sweep
  idempotent (unique partial index `idx_jobs_logical`).
- `documents` — checklist instances link to `compliance_id`.
- `invoices` / `payments` — link to `compliance_id`; never touched by generation.
- `audit_log` — due-rule verification, overrides, assignments append here.

## Migration safety (version 4)

- Only `ADD COLUMN` (via `ensureColumn`, idempotent), `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS` and data backfill — no drops, no rewrites of ids.
- Backfill maps each legacy row's free-text `period` to period bounds using its
  service frequency (`legacyPeriod`), sets its old `due_date` as an **unverified
  internal target**, forces `statutory_due_date = NULL` and
  `statutory_rule_status = 'unverified'`, and records filing evidence from
  `ack_number`/`filed_date` with `filing_confirmed_by_integration = 0`.
- Rows whose period text cannot be parsed keep empty bounds, counted in
  `ambiguous_periods` — nothing is invented.
- The run report is stored in `settings` under `engagement_migration_report_v1`
  (see [../operations/LEGACY-ENGAGEMENT-MIGRATION.md](../operations/LEGACY-ENGAGEMENT-MIGRATION.md)).

## Known limitations

- Single-firm: no `firm_id`, isolation is role/session-based plus query scoping in
  `lib/engagement-queries.ts`.
- `due_date` (legacy) and `internal_target_date` coexist; the UI reads the new column
  and falls back to `due_date`.
- `assessment_year` is only populated for ITR-type services where FY is known.