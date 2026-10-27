# Client and registration model

This document describes the schema currently in `lib/db.ts` (migration 3, “client-onboarding”) and the access layer in `lib/onboarding.ts` / `lib/engagements-db.ts`. It reflects implemented behaviour, including the single-firm limitation.

## Ownership and firm boundary

This installation is **single-firm**. There is no `firm_id` on any table and no row-level tenant policy. The firm boundary is the installation’s data directory (`CA_DATA_DIR`), which holds one SQLite database, encryption/session keys and uploads. Consequences:

- Every query is implicitly scoped to the one firm.
- Cross-**client** references are explicitly checked (a registration or service must belong to the client in the URL).
- Every assignee must resolve to a real user in `users`; an outsider name is rejected.
- Multiple firms require a separate schema change (a `firm_id` on clients, registrations, services, documents, invoices, etc.) and a tenant-aware query layer. That is not implemented and should not be simulated by filtering on names or data directories at request time.

## Entity relationships

```
clients 1 ─── n client_registrations
clients 1 ─── n client_services ─── 1 client_registrations (optional)
client_services 1 ─── n compliance (registration_id, service_id)
compliance 1 ─── n document_requests 1 ─── n documents
client_services 1 ─── n client_service_assignments (history)
client_services 1 ─── n onboarding_activations
clients 1 ─── n onboarding_tasks
checklist_templates (service_code, version) ─── document_requests.template_version / documents.template_version
```

SQLite foreign keys are enabled, but these relationship tables do **not** declare `FOREIGN KEY` constraints. Integrity is enforced by the access layer and by unique indexes. A client delete is blocked while compliance/documents/invoices exist; dependent onboarding rows are removed only after that check.

## `clients`

The existing client master is extended in place. Key fields:

- identity: `client_id`, `name`, `legal_name`, `trade_name`, `entity_type`, `client_status`, `relationship_status`, `relationship_manager`, `date_of_incorporation`, `date_of_birth`;
- identifiers: `pan`, `tan`, `cin`, `gst_number`, `gst_registration_type`, `gst_state_code` (encrypted at rest where sensitive);
- address/contact: `address`, `city`, `state`, `pincode`, `contact_person`, `primary_contact_designation`, `phone`, `whatsapp_number`, `email`, `billing_contact`, `authorised_representative`;
- communication: `preferred_language`, `preferred_channel`, `whatsapp_opt_in`, `whatsapp_consent_at`, `whatsapp_consent_source`, `contact_verified_at`, `contact_verification_note`;
- onboarding: `onboarding_status`, `onboarding_stage`, `onboarding_completed_at`, `engagement_letter_status`, `engagement_letter_date`;
- audit: `created_by`, `created_at`, `updated_by`, `updated_at`, `notes` (internal).

`clients.gst_number` remains a legacy mirror for reports/exports. The structured source of truth for registrations is `client_registrations`; `addRegistration` updates the mirror when the registration is primary (or when the client has no GSTIN yet). Updating the legacy field through the profile API does not automatically create a registration — the registration endpoints/wizard do that.

Sensitive identifiers are encrypted with AES-256-GCM (`lib/crypto.ts`, `enc:v1:` prefix) using `.data/field.key` or `FIELD_ENCRYPTION_KEY`. `lib/db.ts` decrypts on read; only the API boundary masks. The duplicate-PAN check decrypts candidate rows because random-IV ciphertext cannot be compared with SQL equality.

## `client_registrations`

| Column | Notes |
| --- | --- |
| `registration_id` | `REG-###` sequence |
| `client_id` | owning client; checked by the access layer |
| `kind` | `GST`, `TAN`, `CIN`, `PAN`, `Other` |
| `identifier_enc` | encrypted full identifier |
| `identifier_hash` | SHA-256 of the normalised identifier, for uniqueness and lookup without decryption |
| `legal_name`, `state`, `state_code` | registration-specific legal name/state |
| `status` | `Active`, `Suspended`, `Cancelled`, `Needs review` |
| `effective_from`, `effective_to`, `place_of_business`, `filing_frequency` | registration lifecycle |
| `is_primary` | at most one primary per kind is enforced by application logic |
| `verification_status` | `User entered` or `Externally verified`; the migration always writes `User entered` |
| `migration_note` | explains legacy conversion or a checksum failure |
| `created_at`, `updated_at`, `created_by`, `updated_by` | audit fields |

Indexes: `(client_id, kind)` and a partial unique index on `(client_id, kind, identifier_hash) WHERE identifier_hash <> ''`. This permits several GSTINs per client and prevents the same identifier twice.

`addRegistration`/`updateRegistration` validate format and checksum, require a legal name for GST, reject a GSTIN whose embedded PAN differs from the client PAN, order effective/closure dates, and check duplicates. They write audit rows. `deleteRegistration` refuses when non-terminal services or compliance cycles reference the registration.

`inspectGstin` validates the state code, the `Z` at position 14 and the checksum. It extracts the embedded PAN and state. **This is format/checksum validation, not government verification**; no GSTN/income-tax API is integrated.

## `client_services`

The engagement configuration. Columns include:

`service_id`, `client_id`, `service_code`, `service_name`, `line`, `frequency`, `fee`, `billing_cycle`, `auto_invoice`, `owner`, `reviewer`, `manager`, `partner`, `status`, `start_date`, `end_date`, `fee_model`, `setup_fee`, `payment_terms_days`, `fee_effective_from`, `approval_stage`, `registration_id`, `reminder_cap`, `reminder_gap_days`, `next_cycle_on`, `paused_at`, `completed_at`, `cancelled_at`, `created_at`, `created_by`, `updated_at`, `updated_by`.

Unique index: `(client_id, service_code, IFNULL(registration_id,''))`. The v3 migration rebuilt this table to remove the old `(client_id, service_code)` constraint while preserving every `service_id` and row. `getClientServiceByCode` and `createClientService` use the registration-aware key.

Status semantics: `Draft` is configured but not activated; `Active` participates in scheduling; `Paused`, `Completed`, `Cancelled` are terminal/non-scheduling states (paused can resume). A completed/cancelled service cannot be activated. A paused service is skipped by `ensureCurrentCycles`.

## `client_service_assignments`

Append-only history for `preparer`, `reviewer`, `manager`, `partner` and `relationship_manager`:

`assignment_id`, `client_id`, `service_id` (empty for client-level roles), `role`, `assignee`, `assigned_by`, `assigned_at`, `unassigned_at`, `note`.

Reassignment closes the previous row (`unassigned_at`) and inserts a new one. The current assignment is also denormalised on `client_services` for fast reads. Changing `clients.relationship_manager` closes/reopens only the client-level assignment; it does not touch service-level rows.

Role rules (`lib/onboarding.ts`): the assignee must exist in `users`; an article assistant cannot be reviewer/manager/partner; the authorised CA must be a partner; reviewer must differ from preparer when an approval stage is set. These are server checks, not UI-only checks.

## `compliance`, `document_requests`, `documents`

Migration 3 adds `registration_id` to all three, and `template_version` to requests/documents. This is what lets two GSTINs run the same service in the same period without colliding.

`compliance` unique index: `(client_id, service_code, period, IFNULL(registration_id,'')) WHERE service_code IS NOT NULL AND service_code <> ''`. The old three-column index is dropped. `createCompliance` writes `registration_id`; `createCycleForService` passes the service registration and `createDocument`/`createRequestPacket` persist it, so filing evidence is associated with the correct GSTIN.

`document_requests` holds one packet per compliance cycle: period, FY, due date, status, reminder cap/count, next reminder, registration, template version. `documents` holds the individual requested items with the same registration/version, file metadata and review status. `createCycleForService` writes the task, packet, checklist rows and opening timeline event in one transaction; its existence check uses the registration-aware key, making retries safe.

## `checklist_templates`

`(template_id, service_code, version, name, items_json, active, created_by, created_at)` with `UNIQUE(service_code, version)`. Migration 3 seeds version 1 for every catalogue code. `checklistTemplate` reads the highest active version and `createCycleForService` stamps that version onto the packet and documents. Later template changes cannot rewrite historical requests. There is no template-editor UI yet.

## `onboarding_activations` and `onboarding_tasks`

`onboarding_activations`: `activation_id`, `client_id`, `service_id`, `idempotency_key UNIQUE`, `detail` (JSON with compliance id/period/document count), `created_at`. `activateService` checks the key before writing; a repeated request returns the existing cycle and `created: false`. The bulk route scopes the caller’s key to each service.

`onboarding_tasks`: `task_id`, `client_id`, `service_id`, `label`, `kind`, `status`, `due_date`, `created_at`, `completed_at`, with `UNIQUE(client_id, service_id, label)`. `createOnboardingTasks` uses `INSERT OR IGNORE`, so re-activation cannot duplicate the task list.

## `service_catalogue_settings`

`service_code` primary key, `enabled`, `default_frequency`, `default_fee`, `requires_engagement_letter`, `requires_approval`, `updated_at`. Seeded for every catalogue code. Partner-only `PATCH`; audited. This is installation-scoped, not per-firm.

## Migration and recovery

Migration 3 is applied once under `BEGIN IMMEDIATE` by the `schema_migrations` ledger. It:

1. adds profile/onboarding/consent columns to `clients`;
2. adds registration/version columns to compliance, requests and documents;
3. creates registrations, catalogue settings, templates, assignments, activations and tasks;
4. rebuilds `client_services` preserving IDs and data;
5. seeds catalogue settings and v1 templates;
6. backfills one GST registration per legacy client GSTIN — preserving invalid identifiers but marking them `Needs review` and explaining the checksum failure;
7. records `client_migration_report_v1` in `settings`;
8. replaces the compliance unique index with the registration-aware one.

The migration is transactional; a failure rolls back and the ledger does not record the version, so the same code retries on the next start. There is no down migration. Recovery is from the pre-migration database backup (see `docs/operations/CLIENT-DATA-MIGRATION.md`).

## What is not modelled

- No `firm_id` or row-level tenancy.
- No government verification result, GSTN/income-tax credentials or filing integration.
- No statutory computation engine; due dates are defaults.
- No per-service fee-change history table (only `fee_effective_from`).
- No arbitrary firm-authored catalogue entries or template editor.
- No foreign-key constraints between these tables; the access layer owns integrity.
