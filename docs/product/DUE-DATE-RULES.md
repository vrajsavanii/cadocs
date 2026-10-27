# Due-Date Rules

**Status:** implemented (Prompt 5). Table `due_date_rules`, logic in
[lib/due-dates.ts](../../lib/due-dates.ts), API in
[app/api/due-date-rules/route.ts](../../app/api/due-date-rules/route.ts).

## Principle

A statutory deadline is only ever surfaced when a partner has recorded a rule with a
real authority reference. Everything the product ships with is an **unverified planning
default**: it sets the firm's internal target date and is explicitly labelled as
unverified. The product never claims legal lateness from an unverified date.

## Rule shape

| Column | Meaning |
|---|---|
| `rule_id` | `DDR-<SERVICE>-<FREQUENCY>-V<version>` |
| `service_code`, `frequency` | which catalogue service and recurrence the rule covers |
| `effective_from`, `effective_to` | period the rule version is valid for (`''` to = open-ended) |
| `due_month_offset`, `due_day` | due date = period end + N months, on day D (clamped to month length) |
| `internal_lead_days` | days before the statutory date the internal target sits |
| `source`, `authority_reference` | where the rule came from; the reference is mandatory for verification |
| `verification_status`, `verified_at`, `verified_by` | `unverified` / `verified` |
| `version` | monotonic per (service_code, frequency); old versions are never rewritten |

Shipped defaults (migration 4): one **unverified** v1 rule per catalogue service,
`source = "Product default schedule — not verified against a statutory source"`.

## Resolution (`resolveDueDates(serviceCode, frequency, periodEnd)`)

1. Collect rules for the service/frequency whose effective window covers the period end.
2. **Verified rules win.** If exactly one date results → `statutory_due_date` is set,
   `rule_status = 'verified'`, internal target = statutory − `internal_lead_days`.
3. If two verified rules disagree → `rule_status = 'conflicting'`, **no** statutory
   date is chosen, a warning names both dates. The engine never picks arbitrarily.
4. If none is verified → `rule_status = 'unverified'`, `statutory_due_date = null`,
   the rule's computed date becomes the **internal target**, with a warning telling
   the firm a partner must review it.
5. If no rule covers the period → `rule_status = 'missing'`, no dates, a warning says
   to configure one before generating.

On the engagement these land as `internal_target_date`, `statutory_due_date`,
`due_rule_id`, `due_rule_version`, `due_date_source`, `due_date_verified` and
`statutory_rule_status`. The UI renders "Statutory due date" only for verified, and
"Internal target (statutory date unverified)" otherwise (`dueDateSummary`).

## Versioning and verification

`POST /api/due-date-rules` is **partner-only** and always *appends* a new version
(history is immutable); each creation writes an `audit_log` row
(`DUE_RULE_VERIFIED` / `DUE_RULE_VERSIONED`). Validation (`DueRuleError` → 400):

- `due_month_offset` 0–18 integer, `due_day` 1–31 integer, ISO dates required.
- `verification_status = "verified"` requires a non-empty `source` **and**
  `authority_reference` (notification / circular / portal source). A rule cannot be
  marked verified without naming its authority.

`GET /api/due-date-rules` is available to any signed-in role and returns the rules
plus the note that unverified rules supply internal targets only.

## Manual overrides on an engagement

- `internal_target_date` may be overridden by a manager/partner through
  `PATCH /api/engagements/[id]` (`overrideInternalTarget`) — reason recorded in
  status history.
- `statutory_due_date` may only be overridden by a partner
  (`overrideStatutoryDate`) and keeps `due_date_source` describing the manual origin.
  An override never flips `due_date_verified` by itself.

## Known limitations

- All shipped rules are unverified: until a partner verifies them, **no** engagement
  in a fresh installation shows a statutory deadline. That is by design, not a bug.
- Verification is a manual, evidence-based act; there is no automated sync with GST or
  income-tax portals.
- Rules are stored per (service, frequency) — not per state — so state-specific
  deviations need a rule per service variant and are currently out of scope.