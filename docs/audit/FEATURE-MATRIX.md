# Feature Matrix — NexAgent / CADocs (audited 24 Oct 2026)

Legend: **VERIFIED_WORKING** (code + evidence) · **PARTIALLY_IMPLEMENTED** · **UI_ONLY** · **BROKEN** · **NOT_IMPLEMENTED** · **NOT_VERIFIED** (code exists, behaviour not exercised).

## A. Client management

| Feature | Status | Evidence & gaps |
|---|---|---|
| CRUD, search | VERIFIED_WORKING | `app/api/clients/*`; guarded delete (manager+); input validation in `lib/api.ts` |
| 360° desk | VERIFIED_WORKING | `components/views/clients.tsx` panel + `client_360` AI tool |
| PAN/GSTIN at-rest encryption + gated decryption | VERIFIED_WORKING, with tenant-level flaw | `lib/crypto.ts`; see **R1** — bulk-export route ships plaintext identifiers to *all* roles |
| Multiple GST registrations per client | NOT_IMPLEMENTED | single `gst_number` scalar on `clients` |
| Communication consent | VERIFIED_WORKING (needs default change) | `whatsapp_opt_in`; **default is 1 (opted-in) for new clients** — must be 0 commercially |
| Client-to-service relationships | VERIFIED_WORKING | `client_services` table, `lib/engagements-db.ts` |
| Duplicate-cycle/versioning for documents folders (virtual, metadata-backed) | VERIFIED_WORKING (⚠ ephemeral on Vercel) | `lib/engagements-db.ts`, folders module — see B1 |

## B. Engagements & compliance

| Feature | Status | Evidence & gaps |
|---|---|---|
| GST/TDS/ITR/ROC task creation | VERIFIED_WORKING | `lib/services.ts` catalogue + `ensureCurrentCycles()` |
| Recurring generation, duplicate prevention | VERIFIED_WORKING (needs regression test) | idempotent by `(client_id, service_code)` / `(compliance_id)` checks |
| Stage-gated workflow: documents → preparation → review → filing → sign-off → done | VERIFIED_WORKING | `lib/workflow.ts` `STAGE_ORDER`, `ROLE_STAGES`; enforced server-side |
| Role segregation (preparer ≠ reviewer) | VERIFIED_WORKING (structural) | by role assignment; add explicit same-user guard when roles are remapped |
| Closure requires filing evidence (ack) | VERIFIED_WORKING | `lib/workflow.ts` gate, `ack_number` column |
| Filing is manual/recorded, not integrated | PARTIALLY_IMPLEMENTED (correctly honest) | manual ack only; deferred by design |
| Deadline override + reminder recalculation | PARTIALLY_IMPLEMENTED | PATCH compliance routes exist; reminder recalc-on-change not implemented |
| Notices / DSC / UDIN registers | VERIFIED_WORKING | routes + modules; UDIN dedupe enforced |
| AY vs FY modelling for ITR | PARTIALLY_IMPLEMENTED | FY handled (`fyForDate`, `fy_end_month`); explicit AY field missing |

## C. Document management

| Feature | Status | Evidence & gaps |
|---|---|---|
| Requests, packets, per-request reminder state | VERIFIED_WORKING | `document_requests`; `reminder_number`, `next_reminder_at` |
| Upload/download, 8 MB, allow-list | VERIFIED_WORKING with Medium gaps | extension-only validation (**R2**), path-traversal guarded (`path.basename` + prefix check), `no-store` serving |
| Received → verified flow; request status refresh | VERIFIED_WORKING | `refreshRequestStatus` on file attach/remove |
| Rejected / re-upload state machine | NOT_VERIFIED | statuses exist in type model; reject+reopen path not exercised |
| Versioning, checksums, retention, legal hold | NOT_IMPLEMENTED | — |
| Malware/content sniffing | NOT_IMPLEMENTED | **R2** |

## D. Staff workflows

| Feature | Status | Evidence & gaps |
|---|---|---|
| Three roles, server-enforced on every request | VERIFIED_WORKING | `proxy.ts` + `lib/auth.ts` `canAccess`; route-level double-checks |
| Assignment/reassignment | PARTIALLY_IMPLEMENTED | owner/reviewer fields exist on services; no workload balancing/escalation |
| UI reflects backend permissions | VERIFIED_WORKING (spot) | 307/401/403 live-checked for unauthenticated; role matrix not exhaustively scripted — see P4 test plan |

## E. WhatsApp, email, reminders

| Feature | Status | Evidence & gaps |
|---|---|---|
| Dual provider: queue deep-link + Cloud API template send | VERIFIED_WORKING | `lib/whatsapp.ts`; `WHATSAPP_AUTO_SEND=1`; template-only sending (policy-conformant) |
| Opt-in enforcement | VERIFIED_WORKING | enforced in `lib/reminders.ts` + `lib/billing.ts`; default flip needed |
| Initial request + max 3 reminders, durable schedule | VERIFIED_WORKING | `HARD_CAP=3` twice-enforced; cron sweep `GET /api/cron/automation` |
| Reminder cancellation when packet clears | VERIFIED_WORKING (needs race test) | `refreshRequestStatus` checked before sends |
| Escalation task after reminder 3 | NOT_IMPLEMENTED | **R7** |
| Delivery receipts / status webhook | NOT_IMPLEMENTED | **R6** — "Sent" = provider-accepted |
| Inbound webhook / replies become tasks | NOT_IMPLEMENTED | no `app/api/webhooks/*` route |
| Provider message-id idempotency + retries | NOT_IMPLEMENTED | `automation_key` column exists; uniqueness/retry absent |
| Cost tracking | NOT_IMPLEMENTED | — |

## F. Invoices & payments

| Feature | Status | Evidence & gaps |
|---|---|---|
| GST invoice create (CGST/SGST, SAC, place of supply) | VERIFIED_WORKING | routes + views |
| Auto-billing on completed cycle, idempotent | VERIFIED_WORKING | `lib/billing.ts` `invoiceCycleFor()` — unique `compliance_id` + lookup |
| Full/partial payments, history, ageing | VERIFIED_WORKING | routes + derived status |
| Dunning (filing-stage reminders, tone by age) | VERIFIED_WORKING | `lib/automation.ts` `dunning` rule / `dunning_bulk` tool |
| Invoice delivery tracking | NOT_IMPLEMENTED | follows R6 |
| Payment gateway / credit notes / corrections | NOT_IMPLEMENTED | recorded as deferred |
| Invoice numbering | VERIFIED_WORKING | `MAX(suffix)+1` (`nextId`), per-invoice payment numbering (`PAY-INV-…-2`) — no COUNT(*) reuse |

## G. Automation

| Feature | Status | Evidence & gaps |
|---|---|---|
| Six rule types, auto/approval modes, dry-run | VERIFIED_WORKING | `lib/automation.ts`; approval mode defers to `ai_action`s |
| Schedule & auth (cron) | VERIFIED_WORKING | `vercel.json` 30 03 * * *, `CRON_SECRET`/Vercel-marker auth at route |
| DB-backed durable state | VERIFIED_WORKING | `automation_rules`, `automation_runs`, elapsed-time cadence self-heal |
| Run history + audit | VERIFIED_WORKING | `automation_runs`, `audit_log` |
| Idempotency across concurrent instances | PARTIALLY_IMPLEMENTED | lookups prevent duplicates; **no unique index on `automation_key`**; two sanctioned writers can still race on message queues |
| Alerts on sweep failure | NOT_IMPLEMENTED | silent cron |

## H. AI copilot

| Feature | Status | Evidence & gaps |
|---|---|---|
| Bounded tool loop, role-scoped tools | VERIFIED_WORKING | `MAX_ROUNDS=4`/`MAX_CALLS=8`, `toolsForRole` |
| Writes as proposals, approval re-validates | VERIFIED_WORKING | `ai_actions` lifecycle; ownership/status/role/schema re-checks on approve |
| Provider fallback to deterministic | VERIFIED_WORKING | `lib/ai-agent.ts` breaks to keyless router on provider failure |
| Identifier redaction before egress | VERIFIED_WORKING | `ai.ts` system-level redaction of PAN/GSTIN shapes |
| Quota + audit | VERIFIED_WORKING | `AI_DAILY_LIMIT`, `ai_calls` |
| AI bypassing workflow roles | NOTér achieved — verified negative | article write-tools are filtered at registry and re-checked at execution |

## I. Reports & exports

| Feature | Status | Evidence & gaps |
|---|---|---|
| Report calculations on source records | VERIFIED_WORKING (spot-checked) | ageing/realisation/utilisation/profitability/lead-conversion |
| CSV export of registers | VERIFIED_WORKING with **R1 finding** | 6 types: clients/invoices/payments/compliance/documents/timesheets; **`leads` export advertised in docs — NOT_IMPLEMENTED**; clients CSV leaks identifiers to all roles |
| Date/period filtering | PARTIALLY_IMPLEMENTED | fixed trailing-window computations; limited parametrisation |
| Empty/partial/cancelled dataset handling | NOT_VERIFIED | — |

## Summary counts

**VERIFIED_WORKING:** 26 · **PARTIALLY_IMPLEMENTED:** 8 · **NOT_IMPLEMENTED:** 15 · **NOT_VERIFIED:** 4 · **UI_ONLY/BROKEN:** 0
