# Service catalogue

The catalogue is code-defined in `lib/services.ts` and persisted per firm in `service_catalogue_settings` and `checklist_templates`. It describes what the practice sells, how often the work repeats, its default fee and the documents the client must provide. It is **not** a claim that the software files with a government portal or computes statutory liability.

## Seeded services

| Code | Name | Line | Default frequency | Default fee (₹) | Default billing |
| --- | --- | --- | --- | ---: | --- |
| `gstr3b` | GST Filing (GSTR-3B) | GST | monthly | 2,000 | monthly |
| `gstr1` | GST Filing (GSTR-1) | GST | monthly | 1,500 | monthly |
| `gstr9` | GST Annual Return (GSTR-9) | GST | annual | 6,000 | annual |
| `itr` | Income Tax Return | Income tax | annual | 5,000 | annual |
| `advance_tax` | Advance Tax | Income tax | quarterly | 1,500 | quarterly |
| `tax_audit` | Tax Audit Report (3CA/3CB-3CD) | Audit | annual | 15,000 | annual |
| `statutory_audit` | Statutory Audit | Audit | annual | 25,000 | annual |
| `tds_payment` | TDS Payment | TDS | monthly | 500 | monthly |
| `tds_return` | TDS Return (24Q/26Q) | TDS | quarterly | 2,500 | quarterly |
| `roc_annual` | ROC Annual Filing (AOC-4 / MGT-7) | ROC | annual | 8,000 | annual |
| `bookkeeping` | Bookkeeping & MIS | Bookkeeping | monthly | 5,000 | monthly |
| `payroll` | Payroll | Payroll | monthly | 3,000 | monthly |
| `other` | Other / advisory | Other | one-time | 0 | per cycle |

Each definition also carries a `scheduleLabel`, `dueMonthOffset`, `dueDay`, period label style and checklist. Due dates are statutory **defaults** (for example GSTR-1 on the 11th and GSTR-3B on the 20th of the following month); notices and extensions change the real date, which is why generated dates remain editable.

`SERVICE_LINES` groups the catalogue for the wizard: GST, Income tax, Audit, TDS, ROC, Bookkeeping, Payroll, Other. A firm can offer only some of these; the client is never assumed to need all of them.

## Per-client service configuration

`client_services` is the engagement record. Each row stores:

- `service_id`, `client_id`, `service_code`, `service_name`, `line`;
- `registration_id` — the GST registration this engagement belongs to, when relevant;
- `frequency` (monthly/quarterly/annual/one_time) and `start_date`/`end_date`;
- `status` (`Draft`, `Active`, `Paused`, `Completed`, `Cancelled`) and the corresponding pause/complete/cancel timestamps;
- `fee`, `billing_cycle`, `auto_invoice`, `fee_model` (`fixed`, `recurring`, `per_period`, `milestone`, `one_time`), `setup_fee`, `payment_terms_days`, `fee_effective_from`;
- `owner` (preparer), `reviewer`, `manager`, `partner` (authorised CA);
- `approval_stage` (`none`, `review`, `partner`);
- reminder cap and gap, `created_by`/`updated_by`/`updated_at`.

The unique index is `(client_id, service_code, IFNULL(registration_id,''))`. This is why the same service can run once for the Maharashtra GSTIN and once for the Karnataka GSTIN, while a duplicate of the same service on the same registration is prevented. The earlier unique index on `(client_id, service_code)` was removed in migration 3; existing service IDs were preserved.

Fees are configuration, not an invoice. `POST /api/clients` and `activateService` never create an invoice. When a fee or fee model changes through `PATCH /api/client-services/[id]`, `fee_effective_from` is set to the change date so later billing can distinguish historical terms.

## Validation rules

The single rule set is `validateServiceConfig` in `lib/onboarding.ts`:

- the code must exist in the catalogue and be enabled;
- GST-line services require an active GST registration owned by the same client;
- TDS-line services require the client TAN or an active TAN registration;
- a positive fee is required when auto-billing is on; fees cannot be negative;
- payment terms must be an integer from 0 to 180 days;
- billing cycle and fee model must be from the allowed vocabulary;
- preparer and reviewer must be real active users of this installation;
- an article assistant cannot be reviewer, manager or authorised CA;
- the reviewer must differ from the preparer when an approval stage is set;
- audit-line services require a partner as authorised CA and an engagement letter received/approved;
- start/end dates must be valid and ordered.

These checks run on draft creation, configuration update and activation. The UI repeats the common ones for immediate feedback, but a direct API call cannot bypass the server.

## Catalogue settings

`service_catalogue_settings` stores, per service code:

- `enabled` — a disabled service cannot be configured or activated;
- `default_frequency` and `default_fee` — the defaults offered to the wizard and API when a value is omitted;
- `requires_engagement_letter` and `requires_approval` — firm policy flags. The seeded values are `0`; audit services still require a letter/partner through code rules.

`GET /api/service-catalogue` lists the joined code definition + settings. `PATCH` is partner-only and validates the frequency/fee. Settings are installation-scoped (single firm) and audited as `SERVICE_CATALOGUE_UPDATED`.

The catalogue does **not** support firm-authored arbitrary services in this phase. Adding a new statutory service requires a code definition and checklist; the `other` line is the supported escape hatch for advisory/one-off work.

## Checklist templates

`checklist_templates` holds `(template_id, service_code, version, name, items_json, active, created_by, created_at)` with `UNIQUE(service_code, version)`. Migration 3 seeds version 1 for every catalogue code from its in-code checklist.

Activation resolves the active template version and writes it onto `document_requests.template_version` and every generated `documents.template_version`. A later template version therefore does not rewrite historical requests. `ensureChecklistForCycle` adds only missing item names and keeps the existing version on existing rows.

The current UI does not provide a template editor or a “new version” workflow. This is a known gap; the storage and read path are version-aware.

## Operational rules

- **Draft → Active** calls `activateService`. It opens the current period exactly once, creates the document packet/checklist and onboarding tasks, and records an idempotency key.
- **Pause** keeps the configuration and history; `ensureCurrentCycles` skips paused services.
- **Complete/Cancel** retains historical compliance, documents, invoices and timeline records and blocks later activation.
- **Registration changes** are blocked while active/draft/paused services or filing cycles reference the registration.
- **Deleting a service** is blocked while compliance cycles or invoices reference it (see `deleteClientService`).
- **No messaging or invoicing** occurs from catalogue configuration.

## Gaps and external dependencies

- Government portal filing, GSTIN/PAN/TAN verification and statutory computation are **not** implemented. Format/checksum checks are not verification.
- Checklist template editing/version promotion has no UI yet.
- Due-date arithmetic is a default calendar, not a live statutory calendar; extensions must be applied to the generated task.
- The catalogue is installation-scoped; there is no multi-firm catalogue or `firm_id` isolation.
