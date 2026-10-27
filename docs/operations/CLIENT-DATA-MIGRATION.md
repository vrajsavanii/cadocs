# Client data migration (Prompt 04)

This runbook covers the `client-onboarding` migration (schema version 3) that moves a pre-Prompt-04 installation to the structured client/registration/service model. It has been executed automatically on fresh test databases and exercised against a synthetic pre-v3 database by `tests/client-migration.test.ts`. It has **not** been run against a production volume as part of this change.

## What the migration does

The migration is defined as version 3 in `PERSISTENCE_MIGRATIONS` (`lib/db.ts`) and runs once under `BEGIN IMMEDIATE`, recorded in `schema_migrations`.

1. Adds profile, contact-consent, engagement-letter and onboarding columns to `clients` with `ensureColumn` (non-destructive).
2. Adds `registration_id` to `compliance`, `document_requests`, `documents`; adds `template_version` to requests/documents.
3. Creates `client_registrations`, `service_catalogue_settings`, `checklist_templates`, `client_service_assignments`, `onboarding_activations`, `onboarding_tasks`.
4. Rebuilds `client_services` as `client_services_v3`, copies every row preserving `service_id`, drops the old table, renames, and creates `(client_id, service_code, IFNULL(registration_id,''))` uniqueness. This removes the old one-service-per-code constraint.
5. Seeds `service_catalogue_settings` and checklist template version 1 for every catalogue code.
6. Reads legacy `clients.gst_number` rows and inserts one GST registration each:
   - decrypts legacy values (plaintext is accepted by `decryptField`);
   - hashes the normalised GSTIN;
   - extracts state/state code from a checksum-valid GSTIN;
   - marks an invalid number `Needs review`, keeps it, and writes a `migration_note` explaining the checksum failure;
   - writes `verification_status = 'User entered'` and a note that it was not externally verified.
7. Writes `settings.client_migration_report_v1` with `{ at, legacy_clients, gst_registrations_backfilled, flagged_for_review, ambiguous }`.
8. Drops the old three-column compliance unique index and creates the registration-aware one.

`ambiguous` is currently always `0`: the legacy model had a single GSTIN per client, so there is no ambiguous multi-GSTIN split. Invalid GSTINs are counted in `flagged_for_review`, not silently discarded.

## Before running

1. **Stop writes** or put the app in maintenance. The migration runs at process start; a second process must not write during the procedure.
2. **Take a verified backup** using the operator CLI:
   ```bash
   npm run backup -- --target .backups/pre-prompt-04
   npm run backup:verify -- --backup .backups/pre-prompt-04
   ```
   Confirm `integrity_check`/`foreign_key_check` pass, row counts match and file checksums verify. The bundle contains the field/session keys; store it encrypted and outside the repository.
3. Record baseline counts:
   ```sql
   SELECT COUNT(*) AS clients FROM clients;
   SELECT COUNT(*) AS gst_clients FROM clients WHERE gst_number IS NOT NULL AND gst_number <> '';
   SELECT COUNT(*) AS client_services FROM client_services;
   SELECT COUNT(*) AS compliance FROM compliance;
   SELECT COUNT(*) AS documents FROM documents;
   SELECT COUNT(*) AS invoices FROM invoices;
   SELECT COUNT(*) AS payments FROM payments;
   ```
4. Run the migration on a **copy** of the production volume first:
   ```bash
   CA_DATA_DIR=/path/to/copy NODE_ENV=production npx tsx -e "import('./lib/db').then(({getDb,getMigrationStatus})=>{getDb();console.log(getMigrationStatus())})"
   ```
   Expect `pending: 0` and no exception. Then run the application against that copy and spot-check the client list/360 view.

## Running

The normal application start applies the migration automatically. There is no separate migration command. Start one process, wait for readiness, and check:

- `GET /api/health` — database ok, migration `pending: 0` (if the health payload exposes migration status on this build).
- application logs — no `Migration 3 ... failed` error.
- `settings` row:
  ```sql
  SELECT value FROM settings WHERE key = 'client_migration_report_v1';
  ```
- registration count:
  ```sql
  SELECT COUNT(*), status FROM client_registrations GROUP BY status;
  ```
- service IDs preserved:
  ```sql
  SELECT COUNT(*) FROM client_services; -- equal to the baseline
  ```
- compliance/document/invoice/payment counts unchanged, except for application activity after the cutover.

## Verification SQL

```sql
-- One primary GST per legacy client that had a GSTIN
SELECT client_id, COUNT(*) AS gst_count
FROM client_registrations
WHERE kind = 'GST'
GROUP BY client_id
HAVING gst_count > 1;

-- Invalid migrated GSTINs awaiting review
SELECT registration_id, client_id, state, migration_note
FROM client_registrations
WHERE status = 'Needs review';

-- Every migrated registration is explicitly unverified unless a real integration set it
SELECT verification_status, COUNT(*)
FROM client_registrations
GROUP BY verification_status;

-- No orphaned services/cycles
SELECT s.service_id FROM client_services s LEFT JOIN clients c ON c.client_id = s.client_id WHERE c.client_id IS NULL;
SELECT c.compliance_id FROM compliance c LEFT JOIN clients cl ON cl.client_id = c.client_id WHERE cl.client_id IS NULL;

-- Registration-aware cycle uniqueness
SELECT client_id, service_code, period, IFNULL(registration_id,''), COUNT(*)
FROM compliance
WHERE service_code IS NOT NULL AND service_code <> ''
GROUP BY client_id, service_code, period, IFNULL(registration_id,'')
HAVING COUNT(*) > 1;
```

## Rollback and recovery

There is **no down migration**. The rebuild of `client_services` and the registration backfill are one-way at the schema level. Recovery options:

1. **Automatic transactional rollback** — if the migration throws, `ROLLBACK` runs and the ledger version is not inserted. Fix the cause and restart; the migration retries against the original data.
2. **Restore the pre-migration backup** — the supported rollback. Stop the app, move the failed data directory aside (retain as evidence), restore the verified bundle into a fresh `CA_DATA_DIR`, verify with `npm run backup:verify`, and start the previous release. Never delete the damaged directory until the post-incident review is complete.
3. **Forward recovery** — if the migration committed but a post-check fails, correct the data/application forward (`UPDATE`/repair script reviewed by a partner), then re-run the verification SQL. Do not delete registrations to “clean up” without preserving the legacy identifier; mark them `Needs review` or `Cancelled` instead.

## Production approval

This change must not be applied to a live production volume without the firm owner’s explicit approval. Before approval, provide:

- the backup path and verification result;
- baseline row counts;
- the report from a copy run (`legacy_clients`, `gst_registrations_backfilled`, `flagged_for_review`);
- the list of `Needs review` GSTINs requiring authorised correction;
- confirmation that the old release can be restored from the verified bundle;
- a maintenance window and the person responsible for the cutover.

The migration does not delete client records, invoices, payments, compliance tasks or uploaded files. It does rebuild `client_services`; the copy run must show the same service count and the same `service_id` values.

## Known limitations / follow-ups

- No external GSTIN/PAN verification is performed; every migrated identifier is user-entered.
- Invalid legacy GSTINs are retained for review, not auto-corrected.
- The legacy `clients.gst_number` field remains as a mirror; reports that read it continue to work, but new multi-GSTIN clients should be read from `client_registrations`.
- A production run on a real volume, and the restore drill, remain operator actions. The automated test covers a synthetic pre-v3 database only.
