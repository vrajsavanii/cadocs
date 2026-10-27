# Client onboarding

Status: implemented for Prompt 04 on the current single-firm installation.

The onboarding wizard is the controlled path from “a name and a PAN” to an active client whose services, staff, fees, document requirements and first filing periods exist. It extends the existing client master and 360° workspace; it does not create a second client store.

## The eight stages

The UI is `components/views/onboard-wizard.tsx`; the server rules are in `lib/onboarding.ts`. The wizard is a guide, not the source of truth — every stage is re-validated by `POST /api/clients`.

1. **Identity** — legal name, trade name, entity type, PAN, optional TAN/CIN, incorporation or birth date, registered address, city, state, PIN, primary contact, mobile and email.
2. **Registrations** — zero or more GSTINs, TANs, CINs, PANs or other registrations. Each row has its own legal name, state, status, effective/closure dates, place of business and filing frequency. A client can hold several GSTINs.
3. **Services** — select only the services the client has agreed to buy. Nothing in the catalogue is activated by default. Each selected service stores frequency, fee, billing cycle, auto-bill flag, start/end dates, fee model, setup fee, payment terms, approval stage and its GST registration where relevant.
4. **Commercial terms** — engagement-letter status and date. Fees and payment terms are shown per service. Audit services require the engagement letter to be `Received` or `Approved`.
5. **Team** — relationship manager, then a preparer, reviewer, manager and authorised CA per service. Assignees must be active users of this installation; an article assistant cannot review or be an authorised CA.
6. **Documents** — a preview of the checklist items that activation will request. Only selected services contribute items. No document is uploaded and no public link is created here.
7. **Communication** — WhatsApp number, preferred channel and language, authorised representative, contact-verification note, WhatsApp consent evidence and internal notes. WhatsApp consent defaults to **off**.
8. **Review and activation** — local readiness checks plus the server assessment. Submission is disabled while blocking errors remain.

## API surface

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/clients` | any signed-in user | Server-side search, filters and pagination; identifiers masked for non-partners |
| POST | `/api/clients` | partner, manager | Validate and create the client, registrations, service drafts, first periods and onboarding tasks |
| GET | `/api/clients/[id]` | any signed-in user | Client 360 detail plus registrations, onboarding assessment, tasks, assignments and audit |
| PATCH | `/api/clients/[id]` | partner, manager | Structured profile edit, conditional validation and relationship-manager reassignment |
| DELETE | `/api/clients/[id]` | partner | Deletes only when no compliance, document or invoice records exist; dependent onboarding rows are removed with the client |
| GET/POST | `/api/clients/[id]/registrations` | read: any; write: partner/manager | List or add registrations |
| PATCH/DELETE | `/api/registrations/[id]` | partner, manager | Correct or remove a registration; removal is blocked while services or filing cycles reference it |
| GET/POST | `/api/clients/[id]/services` | read: any; write: partner/manager | List services or configure one; `activate: false` creates a draft |
| PATCH/DELETE | `/api/client-services/[id]` | partner, manager | Configure, pause/resume/cancel or remove an engagement |
| GET/POST | `/api/clients/[id]/onboarding` | read: any; write: partner/manager | Assessment/tasks, or activate one service/all drafts |
| POST | `/api/clients/bulk` | partner, manager | Confirmed bulk manager/status updates, capped at 200 clients |
| GET/PATCH | `/api/service-catalogue` | read: signed-in; write: partner | Firm-scoped catalogue defaults, enablement and approval requirements |

`proxy.ts` also enforces the role policy at the edge; the route handlers repeat the check so a direct invocation cannot bypass it.

## Server validation

`validateClientProfile` returns field-level issues with `error` or `warning` severity:

- legal name, entity type and PAN format; TAN/CIN/GSTIN formats where supplied;
- GSTIN checksum and state code, and the PAN embedded in the GSTIN must match the client PAN;
- duplicate PAN detected by decrypting existing client rows (PAN is encrypted with a random IV, so the comparison is not a SQL equality);
- company/LLP entities require an incorporation date; individuals can use a date of birth;
- address, city and state are required for non-individuals; address is a warning for individuals;
- mobile must be a valid Indian 10-digit number; email format is checked;
- WhatsApp consent source is a warning when consent is claimed without evidence.

`validateRegistration` rejects an invalid GSTIN/TAN/CIN/PAN, a closure date before the effective date, a GSTIN whose PAN differs from the client, and a duplicate `(client, kind, identifier)`.

`validateServiceConfig` is the central service rule set:

- the service must exist and be enabled in the catalogue;
- frequency must be monthly, quarterly, annual or one-time;
- a GST-line service needs an active GST registration belonging to this client;
- a TDS-line service needs a TAN on the client or an active TAN registration;
- fees must be finite and non-negative; auto-billing requires a fee above zero;
- billing cycle, fee model and payment terms (0–180 days) must be valid;
- preparer and reviewer are required; the reviewer must be independent when an approval stage is set;
- audit services require a partner as authorised CA and an engagement letter received/approved;
- assignments must resolve to a real active user with a compatible role.

The same rules are used by the wizard, `POST /api/clients`, `POST /api/clients/[id]/services`, `PATCH /api/client-services/[id]` and the assessment endpoint. There is no second, UI-only validation path.

## Activation

`activateService(serviceId, actor, idempotencyKey)`:

1. Validates the current service configuration and its registration.
2. Opens the first period through `createCycleForService` (compliance task, document request packet, checklist rows and the first timeline event in one transaction).
3. Creates onboarding tasks: confirm scope/engagement letter, verify opening information, confirm the registration, confirm billing terms when auto-billing is on, and assign a relationship manager when missing.
4. Records the activation in `onboarding_activations` under a unique idempotency key.
5. Writes an audit entry.

Retrying the same key returns the existing engagement and reports `created: false`. A different key on an already-active service also returns the existing current period rather than opening another one. The bulk activation route scopes each key to its service, so activating three drafts in one request opens three periods while a retry opens none.

Pausing filters the service out of the scheduler (`ensureCurrentCycles` only considers `Active`). Cancelling or completing a service blocks later activation. Historical compliance, documents, invoices and timeline events are retained.

## Status semantics

- `clients.onboarding_status`: `In progress` or `Active`.
- `clients.onboarding_stage`: last stage reached (`review`, `services`, `activation`, `complete`).
- A client becomes `Active` only when every selected service activated and no error remains. A partial activation leaves the client `In progress` with the successful services visible.
- Assessment completeness is calculated from required checklist items: identity, contact, registrations needed by selected services, services, commercial terms, team, checklist generation, communication/consent and activation. Cancelled/completed engagements are excluded from the denominator.
- `can_activate` is deliberately separate from 100% completeness: a valid draft may be activatable while optional information is still missing.

## Deliberate limits

- **No statutory verification.** PAN, GSTIN and TAN are format/checksum validated only. `verification_status` is `User entered`; the UI says “user-entered, not externally verified”. No government API is integrated.
- **No automatic messaging.** Onboarding never calls WhatsApp. Requests and consent are prepared for the later messaging phase; the result view says no message was sent.
- **No invoice generation.** Fees and billing terms are stored; creating a client never raises an invoice.
- **No upload during onboarding.** The checklist is generated; uploads continue through the existing authenticated document mechanism.
- **Single-firm boundary.** There is no `firm_id` column or cross-firm data model. The installation’s data directory is the firm boundary; cross-client registration/service use and non-firm assignees are rejected. See `CLIENT-AND-REGISTRATION-MODEL.md`.
- **Catalogue editing is limited.** Partners can enable/disable services and change default frequency/fee/letter/approval flags. Editing checklist templates through the UI is not implemented; templates are seeded v1 and versioned rows are honoured.

## Tests

`tests/onboarding.test.ts` covers conditional profile validation, identifier masking, multiple GST registrations, missing/invalid registrations, idempotent activation, pause/cancel, fee validation, assignment rules, service-specific checklists, invoice/payment preservation, WhatsApp silence, truthful completeness, filtering/pagination and cross-client isolation. `tests/client-migration.test.ts` exercises the legacy GSTIN backfill in a child process.
