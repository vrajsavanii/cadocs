# Client 360° workspace

The 360° view is the existing client modal in `components/views/clients.tsx`, extended by `components/views/client-profile-extras.tsx`. It is loaded from `GET /api/clients/[id]`, which returns the client detail plus the onboarding assessment, registrations, onboarding tasks, assignment history and a record-scoped audit tail.

It is a view over the existing client master, compliance, documents, invoices, proposals, messages and workflow timeline — not a separate client record system.

## Sections

### Overview

- Legal name, trade name, entity type, client status and relationship manager.
- Contact person, phone, email, location, registered address and PIN.
- PAN, TAN, CIN/LLPIN, legacy GSTIN mirror, preferred channel/language.
- Fee totals: billed, collected, outstanding, overdue.
- Service badges and WhatsApp consent state.

### Onboarding completeness

- Percentage and progress bar from `assessOnboarding`.
- Required checklist: identity, contact, registrations needed by selected services, services, commercial terms, team, checklist generation, communication/consent and activation.
- “Ready” / “Needs attention” from `can_activate`; field/service-scoped blocking errors and warnings; missing registration kinds; outstanding onboarding tasks.
- Cancelled/completed services are not allowed to hold the client at an artificially incomplete state.

### Registrations

- One row per GSTIN/TAN/CIN/PAN/other registration, with primary flag, status, state, filing frequency and verification label.
- Partners see the full identifier; managers and article assistants see `identifier_masked`.
- “Add” opens the registration modal. Status changes use `PATCH /api/registrations/[id]`; removal is blocked while services or filing cycles reference the row.
- The view states that user-entered data is not externally verified.

### Services

- Every engagement with status, frequency, fee, billing cycle, payment terms, registration, preparer → reviewer, manager and authorised CA.
- Current period, due date, document progress and stage badge.
- Actions: configure, pause/resume, activate a draft, add a service.
- Configuration edits fee/frequency/billing/auto-bill/registration/team/fee model/setup fee/payment terms/approval/start-end dates. Historical compliance is not regenerated.
- Adding a service uses `POST /api/clients/[id]/services`; it configures and activates in one step unless `activate: false` is sent.

### Compliance

- The existing modal panels list compliance tasks with period, due date and status; the service panel shows the current workflow stage.
- The workflow trail shows stage moves (`task_events`), including the opening event and who made each move.

### Documents

- Outstanding document packets with received/pending counts, reminder cap usage, next reminder and a “Chase” action.
- The existing document panel lists requested documents, received/rejected state and file names.
- Chase uses the existing document-request endpoint; it may queue a message, subject to provider and consent rules. It is not part of onboarding.

### Fees

- Configured service fees in the service rows.
- Issued invoices, outstanding/overdue totals and payment history from the existing invoice/payment tables.
- No invoice is created by the 360° view or by onboarding.

### Communication

- Preferred channel/language, WhatsApp opt-in, consent source, contact-verification note/date.
- Existing proposals and message history remain in the proposals/communication panel.
- Consent is shown as evidence, not inferred from a valid phone number.

### Audit history

- Record-scoped `audit_log` entries for the client, its registrations and its service engagements: profile changes, registration add/update/remove, service enrollment/update/activation/pause/cancel, catalogue changes and assignment changes.
- Assignment history (`client_service_assignments`) preserves who was assigned, by whom, when and when they were unassigned.
- The workflow timeline is separate and shows stage moves on filings.

## Permissions and masking

`GET /api/clients/[id]` requires a signed-in session. Mutating routes require partner or manager; article assistants are read-only.

| Role | Client read | Full PAN/GSTIN/TAN | Internal notes | Client/registration/service write | Delete client |
| --- | --- | --- | --- | --- | --- |
| partner | yes | yes | yes | yes | yes (only with no linked records) |
| manager | yes | masked | yes | yes | no |
| article | yes | masked | no (`notes` cleared) | no | no |

Masking is applied server-side by `maskClientForRole` and `listRegistrations`; the browser does not receive the full identifiers for non-partners. `maskIdentifier` masks GSTIN as `27••••••F1ZV` and shorter identifiers as first/last characters. Audit rows never contain the full PAN/GSTIN; they use the client name and registration kind/state.

The client detail endpoint also returns the full profile to the server-side component; only the API boundary masks it. Any new API that returns client rows must apply the same role masking.

## Search and filters

`GET /api/clients` uses `searchClients` with server-side filtering and pagination:

- text over name/legal name/email/phone/city;
- client status, entity type, relationship manager;
- active service code;
- GST registration state/state code;
- preparer/reviewer;
- onboarding state (`active`, `in_progress`, `incomplete`);
- missing mandatory details, unassigned services, upcoming deadlines (next 30 days), outstanding fees;
- `page` / `page_size` (10–100, default 25).

Bulk operations (`POST /api/clients/bulk`) are partner/manager only, capped at 200, require `confirm: true` for more than one client, validate the assignee/destination value, write audit rows and are safe to retry (already-assigned clients are reported as skipped). There is no bulk delete.

## Known limitations

- The UI displays the existing single-firm data set; there is no `firm_id` column or per-firm row-level security. The installation’s data directory is the firm boundary.
- The 360° view does not expose a checklist-template editor or a fee-change history table; `fee_effective_from` is stored for later use.
- The audit tail is capped at 80 rows and is not a full export; the existing audit/export surfaces remain the source for a complete ledger.
- Compliance status is computed from due dates and filing state; the 360° view does not perform statutory filing.
