---
title: "CADocs — Practice Management for Indian CA Firms"
email: "varsha@cadocs-ca.vercel.app"
---

# CADocs — Product, Technology, Workflow & Requirements Report

**Prepared for:** [Your Firm Name]
**Version:** v3.1 (deploy 24 October 2026)
**Status:** Deployed to Vercel production — https://cadocs-ca.vercel.app
**Author design record:** `docs/AI-LAYER.md`, `docs/AUTOMATION.md`
**Market & audit record:** `REPORT.md`, `CADocs-Client-SRS.md`

---

## 1. Product report — what CADocs is and what it does now

CADocs is a practice-management system built for small-to-mid Indian Chartered Accountancy firms. It is the operational layer a firm uses around filing: the calendar, the client desk, the document chase, fee recovery, and the communication that ties them together. The value proposition is not tax computation — a dozen tools already do that — but one place where a 2–25 person firm can see what is due, what is missing, what is owed, and what was last said to the client, without per-seat pricing or a cloud migration project.

### The build it now (verified against the running app and the API layer)

The app ships as sixteen modules, grouped into the six moves of a working day plus Settings. Every module renders from a local SQLite database on the server, and every write goes through REST route handlers under `app/api/*`. The sidebar, section tabs, dashboard cards, and the "?" help panel all read from one source of truth (`lib/nav.ts`), so organising the practice is one edit.

**The day, in the software's own order:**

| Move | Route | Modules | What staff do there |
|---|---|---|---|
| **My day** | `/` | Dashboard | Four numbered cards drawn from live data: clear the statutory calendar, unblock the document chase, collect what is already earned, send what automation prepared. A brief headline is generated on every load. A first-run setup card appears until firm profile, first client, and automation are all done. |
| **Engagements** | `/workflow` | Engagement desk | Per-service work moving through documents → partner sign-off. Configured engagements seed the statutory calendar with due dates for the current period. |
| **Compliance** | `/compliance`, `/notices`, `/dsc`, `/udin` | Filing calendar · Notices · DSC · UDIN | One calendar for GST/TDS/ITR/ROC work with owners and due dates; overdue items rise to the top. Notices carry reply deadlines and a draft-reply outline. DSC tracks token validity with expiring-soon warnings. UDIN records the **real** ICAI number and rejects duplicates. One click generates next period's GSTR-1/3B/9, TDS, ITR, audit or ROC tasks for every active client, duplicate-safe. |
| **Documents** | `/documents`, `/folders` | Request tracker · Client folders | Request documents against a client, chase aged requests, receive file uploads (8 MB, allow-listed types) and mark them received. Reminders are logged in a `messages` table so "chased" is a fact, not a toast. Folders give client → financial year → category with files in place. |
| **Clients** | `/clients` | Client master + 360° desk | Search any client; open the 360° panel for balances, open compliance, pending documents, invoices, proposals, and the last thing said. Edit and guarded delete. |
| **Fees** | `/invoices`, `/timesheets`, `/reports` | Invoices · Timesheets · Reports | GST invoices with CGST/SGST split, SAC, place of supply and a printable letterhead view. Record full and partial payments with mode and reference; ageing is computed, not typed. Timesheets logged by the team and approved by a manager. Reports: receivables ageing, billed vs collected, realisation, staff utilisation, compliance health, client profitability, lead conversion — all exportable to CSV with deep links back to the record. |
| **Automation** | `/automation` | Standing rules, run history, outbox | Write a rule once in plain English; the sweep runs the repetitive half of the week — document chasing, fee dunning, recurring compliance generation, overdue/DSC/notice escalation. Prepared messages wait in an outbox as `Queued`; a human opens the WhatsApp/email deep link and marks it sent. Nothing is sent by the software. |
| **Grow** | `/leads`, `/proposals`, `/campaigns` | Leads · Proposals · Campaigns | Enquiries are scored hot/warm/cold and assigned. Proposals generate from a lead, print/copy, and an accepted proposal converts into a client without retyping — the lead is closed as Won. Campaigns send bulk, tokenised per-client messages with WhatsApp/email dispatch links. |
| **Settings** | `/settings` | Firm profile, AI, security, accounts | Firm name, address, GSTIN. AI provider/toggle and a hard kill-switch. Password rotation for all three roles. Role explainer. Partner-only account management. |

Two surfaces sit above all modules:

- **AI Copilot** — `/agent` (full chat), `⌘J` / `Ctrl+J` anywhere (global assistant palette), and inline assists on the client desk, compliance, invoices, and notices pages. The same agent answers all three, with a tool trace shown and any write held as a pending action until a partner or manager approves it.
- **Practice brief** — a 3–4 sentence morning headline generated on every dashboard load from live rows. With a provider it is rewritten for readability under a hard "never change a number" rule.

### Live-verification snapshot (24 Oct 2026)

| Check | Result |
|---|---|
| `GET /api/health` | returns 200 from the deployed Worker |
| Public pages | `/site`, `/privacy`, `/login` render with full content (HTTP 200); the workspace root `/` and every protected route return 307 to login when unauthenticated — auth middleware is live |
| Size of the served app | ~14–15 KB HTML shell on a cold, unauthenticated request |
| Lead capture | `POST /api/public/demo-request` accepts a form post, validates, scores, and writes a real lead into the Leads module (rate limited to 5 requests per IP per 10 minutes, honeypot field, cross-origin rejected) |

One reality to surface plainly: on Vercel the database lives in `/tmp/ca-suite`, which is per-instance and ephemeral. A burst test showed some requests hitting a fresh instance, and data is lost on cold start. The deployed site is therefore a working demo and a workflow evaluator, not a shared multi-user store. For real client records, point `CA_DATA_DIR` at a persistent volume (or move the data layer to a hosted database) before going live with genuine client data.

---

## 2. Features report — what is implemented, what is deferred

### Fully implemented and verified

**Dashboard & first run**
- Guided day: four numbered cards filled from live data, each with the one action that clears it.
- KPIs, revenue chart, urgent deadlines, activity feed, and a generated practice brief.
- First-run setup card: firm profile, first client, switch automation on — it disappears once all three are done.
- Three role accounts are created on first boot; generated passwords are written once to `.data/bootstrap-credentials.txt` (mode 0600).

**Compliance**
- Statutory calendar: GST, TDS, ITR, ROC filings with owners, due dates, overdue detection, ageing clock.
- Mark-filed and status tracking.
- One-click recurring compliance generation for all active clients, duplicate-safe.
- Notices: notice number, authority, amount, response deadline, reply outline drafted by AI, status flow (Open → In Progress → Responded → Filed), UDIN linkage.
- DSC tracker: token validity, expiring-soon warnings, firm vs client DSC.
- UDIN register: real ICAI UDIN capture, format validation, duplicate rejection, search, audit trail.

**Documents**
- Client document requests with document type and pre-filled WhatsApp/email deep links.
- Aged-chase visibility (anything older than five days is a chase).
- File upload (8 MB, allow-listed types) and download.
- Received/verified workflow; chase stops when received.
- Logged chase history, so "we asked three times" is an auditable fact.
- Client folders: client → financial year → category, with files stored in `.data/uploads`.

**Clients**
- Client master with search by name, phone, or email.
- 360° desk: services, balances, open compliance, pending documents, invoices, proposals, recent messages.
- Edit and guarded delete (article staff cannot).
- One-click reminder from the desk.
- PAN/GSTIN encrypted at rest; article staff cannot see them.

**Invoices & fees**
- GST invoice creation: amount, 18% GST as CGST 9% + SGST 9%, SAC code, place of supply, description.
- Printable letterhead view with firm GSTIN, address, and client details.
- Record full and partial payments with mode (UPI/cash/cheque) and UPI reference.
- Payment history on every invoice.
- Derived status and ageing (2/15/30/60/90+ days); overdue detection.
- Settlement: fully paid invoice closes and updates the client's money position.
- CSV export of invoices, payments, clients, compliance, documents, timesheets, leads.

**Timesheets & reports**
- Timesheets: person, client, date, hours, description, approval flow.
- Utilisation feed: billable vs total hours, realisation per staff.
- Reports: receivables ageing buckets, billed vs collected, realisation rate, staff utilisation, compliance health, client profitability, lead conversion.
- Deep links in exports back to the specific record.

**Automation**
- Six rule types: `chase_documents`, `dunning`, `generate_compliance`, `escalate_overdue`, `dsc_watch`, `notice_watch`.
- Two modes per rule: `auto` (executes, writes a run + audit entry) and `approval` (prepares a pending action for the copilot).
- Seven one-click presets for the CA playbook (chase after 5 days, dun after 30, monthly GSTR-3B due the 20th, TDS 26Q due the 7th, escalate at 3 days overdue, DSC warning at 30 days, notice watch at 3 days).
- Elapsed-time cadence (`daily`/`weekly`/`monthly`) so a missed day self-heals.
- Three ways to run: scheduled (`GET /api/cron/automation`, protected by `CRON_SECRET`), operator Run now/Preview, and per-rule Run/Preview.
- Natural-language rule planning: `POST /api/automation/plan` maps a sentence to a rule draft; a configured provider can only refine a draft that is re-validated before saving.
- Outbox: prepared messages with `wa.me`/`mailto:` deep links, Sent and Dismiss.
- Run history and per-run detail.
- Roles: partner and manager configure/run; article sees read-only.

**Grow — Leads, Proposals, Campaigns**
- Leads: scored pipeline, stage changes, assignment.
- Proposals: generated from a lead with prospect/company name, entity type, services, fee; print/copy; status flow that advances the lead; accepted proposal converts into a client and closes the lead as Won.
- Campaigns: bulk reminders per audience, tokenised per-client messages, WhatsApp/email dispatch links.

**AI layer**
- Three surfaces: global palette (`⌘J`), module assists, and the Copilot page.
- 13 typed tools with JSON schemas, role allow-lists, and validators that re-run at execution.
- Bounded tool loop: max 4 rounds, max 8 tool calls, 15 s per provider call.
- Writes are proposals, never executions: first write lands as a pending `ai_action`; approval re-validates ownership, role, schema, and domain before executing.
- Role scoping: article accounts get reads only and are told plainly they cannot create records.
- Keyless by design: with no provider key, the same tool registry is driven by a deterministic intent router; each module assist has its own deterministic answer. The product never depends on a network call to work.
- Keyed path: Gemini → Groq → OpenRouter → NVIDIA, first key found wins, all free-tier capable; `AI_PROVIDER`-style explicit selection is unnecessary because keys are the switch.
- Privacy: `ai_enabled` in Settings is a hard kill-switch; only aggregate facts (counts, amounts, due dates, names) are sent; PAN/GSTIN-shaped tokens are stripped from every prompt server-side; documents, passwords and identifiers are never included.
- Quota + audit: `AI_DAILY_LIMIT` (default 80, min 5) per user per day; every call written to `ai_calls` with tools used, rounds, latency, status; proposals and decisions land in `ai_actions` and surface in the audit feed.
- Inline assists that remain: reminder rewrite, document classification, dashboard brief.

**Security, auth & privacy**
- scrypt-hashed passwords with per-user salts.
- HMAC-signed httpOnly session cookies (12h, SameSite=Lax); logout and password changes bump a per-user token version, instantly invalidating every outstanding cookie.
- Three roles enforced server-side by `proxy.ts` on every request: Partner (all), Manager (operations + billing, no settings/users/client deletes), Article (read-only + own timesheets, messages, AI).
- CSRF defence: cross-origin mutations rejected by Origin check.
- Abuse brakes: login limited to 10 attempts per IP+username per 15 minutes; writes limited to 300 per user per minute.
- Headers: CSP, `X-Frame-Options: DENY`, nosniff, strict referrer, permissions policy, opener isolation, HSTS in production.
- PAN/GSTIN encrypted at rest with AES-256-GCM; legacy plaintext rows migrated on boot.
- Data rights: CSV export of every register (access/portability), client edit (correction), guarded cascading delete (erasure), audit trail (accountability).

**Public marketing site**
- `/site` is public and is the front door for visitors; the workspace itself stays gated.
- Copy and numbers live in `lib/site-content.ts`; screens on the marketing site are built from the app's own `Card`/`Stat`/`StatusPill`/`Progress` primitives so the two look like the same product.
- The workflow story is driven by scroll position with incoming/outgoing screen zoom.
- Lead capture via `POST /api/public/demo-request`.
- Every animation respects `prefers-reduced-motion`.

**Identifiers**
- Sequential IDs use `MAX(suffix)+1` (not `COUNT(*)`), so deleting a record can never resurrect an ID.
- Payments are numbered per invoice (`PAY-INV-2026-013`, `-2` for splits).

### Deferred, with rationale

| Deferred | Why |
|---|---|
| **Auth & roles** | Needs a session model and an onboarding decision (local admin vs SSO). Shipping it half-done would be worse than the open local build. It is the first item of the next release. |
| **Client portal & e-signature** | Meaningful only with auth and file-retention rules. |
| **Automated WhatsApp/email** | Requires a provider account, opt-in handling, and Meta template approval. The app now records intent and supports one-click sending honestly. |
| **Payment gateway** | UPI/Razorpay integration needs merchant credentials; payment recording is in place. |
| **e-Invoicing/IRP, MCA/IT portal sync** | Government integrations are a separate compliance project with credential and liability implications. |

### What the earlier audit (REPORT.md) flagged as still fake/incomplete — and what that means now

| Old flag | Current state |
|---|---|
| "Remind"/"Chase" buttons were fake toasts | Replaced by a recorded `messages` log and a reminder composer that opens WhatsApp/email pre-filled and marks the message sent. "Sent" is now a fact. |
| Documents had no files | File upload/download added; status advances to Received; safe storage under `.data/uploads`. |
| Invoices were ledger rows only | GST invoice document with CGST/SGST, SAC, place of supply, payment recording (full/partial), payment history, derived status. |
| UDIN fabricated a reference | UDIN now captures the real ICAI number, validates format, rejects duplicates. |
| Clients could not be edited or deleted; no 360 | Client 360 added; edit and guarded delete available to partner/manager. |
| Proposals could not become clients | Accepted proposal converts into a client; lead closed as Won. |
| No recurring compliance generation | Generate-compliances action with duplicate protection. |
| No reports or exports | Reports with CSV export and deep links. |

---

## 3. Technology stack report

### Platform & runtime

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4.
- **Runtime target:** Node.js ≥ 24 (the data layer uses the built-in `node:sqlite` module).
- **Hot reload / local dev:** `next dev`; production: `next build && next start`.
- **Build tooling:** PostCSS with `@tailwindcss/postcss`; no separate `tailwind.config.js` — the theme is declared in `app/globals.css` via `@theme {}`.
- **Font:** `next/font/google` self-hosts Plus Jakarta Sans (subsets latin, weights 400/500/600/700/800) — zero Google Fonts requests, no layout shift.

### Data

- **Database:** SQLite via Node's built-in `node:sqlite`, in rollback-journal mode (WAL's shared-memory writes make the dev file watcher recompile in a loop, so rollback journal is chosen for dev stability).
- **File:** `.data/ca-suite.db`, auto-created and seeded on first boot with 12 clients, 20 compliance tasks, leads, invoices, payments, notices, DSC, UDIN, timesheets, proposals, and a campaign.
- **Runtime state root:** `lib/data-dir.ts` — locally `.data/`; on Vercel (when `VERCEL` is set) falls back to `/tmp/ca-suite`. This single function is the source of truth for where the DB, keys, and uploads live.
- **Uploaded client files:** `.data/uploads/`, never served as public assets.
- **Reset:** delete the `.data` directory to restore the clean demo dataset.

### API & auth

- **API shape:** REST route handlers under `app/api/*` — GET/POST/PATCH/PUT/DELETE as applicable — returning JSON with proper status codes and typed input validation in `lib/api.ts`.
- **Auth gate:** `proxy.ts` runs on the Node.js runtime for every request. It verifies the HMAC session cookie, resolves the user in SQLite, redirects unauthenticated browsers to `/login` (APIs get 401 JSON), enforces the central role policy on every mutation (403), blocks cross-origin mutating requests (Origin check), and applies a per-user write rate limit.
- **Passwords:** scrypt, 64-byte digest, per-user 16-byte salt, timing-safe compare.
- **Sessions:** HMAC-SHA256 signed, httpOnly, SameSite=Lax, 12h expiry, `Secure` when served over HTTPS.
- **Revocation:** logout and password changes bump a per-user `token_version`; replaying a stolen session cookie returns 401.
- **Encryption at rest:** client PAN and GSTIN are AES-256-GCM encrypted in SQLite with a machine-local key; decryption happens only in the DB mapping layer. `FIELD_ENCRYPTION_KEY` can override the auto-generated key.
- **Rate limits:** login 10 attempts per IP+username per 15 minutes (11th → 429); writes 300 per user per minute (429 with Retry-After); AI calls per IP.

### AI layer

- **Agent core:** `lib/ai-agent.ts` — bounded tool loop (max 4 rounds, max 8 tool calls), approval lifecycle, keyless router.
- **Tools:** `lib/ai-tools.ts` — 13 typed tools with JSON schemas, role allow-lists, and validators that re-run at execution.
- **Provider layer:** `lib/ai.ts` — Gemini, Groq, OpenRouter, NVIDIA NIM; first key found wins; timeout-guarded; never throws; failures fall back silently to deterministic answers.
- **Prompts:** `lib/ai-prompts.ts` — versioned system prompts.
- **Deterministic fallback:** `Plan my week`, `Who owes us the most?`, `request … from <client>`, `create <filing> for <client> due <date>`, `remind <client> about …` — plus per-module-assist deterministic answers.
- **Privacy:** `ai_enabled` hard kill-switch; aggregate facts only; PAN/GSTIN tokens stripped server-side; documents never included.

### Automation

- **Rules engine:** `lib/automation.ts` — six rule types, two modes (`auto`/`approval`), seven presets, natural-language planning (`POST /api/automation/plan`), elapsed-time cadence, outbox on the existing `messages` table.
- **Scheduled sweep:** `GET /api/cron/automation`, declared in `vercel.json` as a Vercel Cron job (`30 3 * * *`), protected by `CRON_SECRET`.
- **Audit:** every rule change and run writes `automation_runs` and `audit_log`.

### UI & design system

- **Shell:** `components/shell.tsx` — sidebar, topbar, mobile nav; `components/ui.tsx` — design-system primitives; `components/interactive.tsx` — modals, toasts, global search; `components/ai-command.tsx` — global `⌘J` palette; `components/ai-assist.tsx` — inline module assist.
- **Theme:** warm off-white canvas (`#ebe9e4`), white surface, sage/gold/green accent family, rounded 24px cards, 14px inputs, custom scrollbars, print sheet styles for invoices/proposals.
- **Animations:** `rise`/`fade` entrance curves, cursor ripple on the public marketing site, all respecting `prefers-reduced-motion`.
- **Section tabs:** `components/section-tabs.tsx` reads `lib/nav.ts` so the tab strip and the rail stay in sync.

### Architecture (folders)

```
app/
  layout.tsx              app shell (sidebar, topbar, mobile nav, toasts, ⌘J)
  page.tsx                dashboard (server component)
  <module>/page.tsx       one route per module, dynamic + server-rendered
  api/<module>/route.ts   REST handlers
  api/ai/...              copilot, assists, approvals, usage
  api/automation/...      rules, runs, plan
  api/cron/automation     scheduled sweep
  api/export              CSV streaming
  api/documents/[id]/file upload/download
  api/public/demo-request lead capture
  site/...                public marketing site
  privacy, login, help    public/gated surfaces
components/
  shell, ui, interactive, ai-command, ai-assist, markdown, site/*
  views/*.tsx             client views per module
lib/
  db, proposals, api, crypto, auth, ai, ai-agent, ai-tools, ai-prompts,
  insights, format, types, nav, data-dir, onboarding, services, whatsapp,
  reminders, automation, engagements-db
proxy.ts                  auth gate, role policy, CSRF, rate limits
```

### Deployment

- **Host:** Vercel (project `cadocs`, production branch of this checkout).
- **Live URL:** https://cadocs-ca.vercel.app (`cadocs-ca` because `cadocs.vercel.app` was already registered to another account).
- **Environment variables (production + preview):** `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `STAFF_PASSWORD`, `CA_DATA_DIR` = `/tmp/ca-suite`, optional provider keys (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`), optional `CRON_SECRET`, optional `AI_DAILY_LIMIT`.
- **Deploy method:** `scripts/deploy.sh` (production) or `scripts/deploy.sh --preview`. The script exports the working copy without `.git` (so Vercel does not see the placeholder commit author `user@example.com` and refuse the build), excluding `node_modules`, `.next`, `.data`, screenshots, the legacy `CA-automation-main/` folder, and deploy credentials. Long-term fix: set `git config user.email` to the email on the Vercel account and plain `npx vercel deploy --prod` works again.
- **Vercel CLI:** 65.2.0 (installed globally at `C:\Users\vrajs\AppData\Roaming\npm\vercel`).
- **Cron:** `vercel.json` declares `GET /api/cron/automation` at `30 3 * * *`.

### Performance (local measurements, warm cache, seeded DB)

- TTFB 13–62 ms per page; full HTML 14–66 ms.
- Payloads 45–112 KB including the React Server Component stream.
- Fonts self-hosted; zero Google Fonts requests.
- The app shell queries only `COUNT(*)` aggregates for nav badges instead of loading every table on each navigation.
- SQLite rollback-journal mode so reads never touch the project tree.

### Known technical caveats

- On Vercel, `/tmp` is per-instance and ephemeral: writes are not shared between instances and are lost on cold start. The deployed site is a working demo, not a shared multi-user store.
- The build sends a small HTML shell for unauthenticated requests (14–15 KB) because the workspace root and protected routes redirect to login — that is by design, not a missing page.
- The AI provider tool-calling path is code-complete but cannot be exercised without an API key in the environment; the deterministic keyless path is the one tested offline.

---

## 4. Workflow report — how a CA firm actually uses it, end to end

### The seven moves of a working day, in the order the day happens

The sidebar lists the practice as six workflow sections (plus Settings, which you visit rather than work in). The whole app — every route, every tab, every dashboard card — is organised around these moves, so a firm can work top-to-bottom and know where everything lives.

#### Move 1 — My day (`/`)

Four numbered cards, drawn from live data. Each tells you the number, what it means, and gives you one button. If a card shows zero, that move is done for the day.

1. **Clear the statutory calendar** — overdue and due-this-week filings.
2. **Unblock the document chase** — requests open more than five days.
3. **Collect what is already earned** — invoices past their due date.
4. **Send what automation prepared** — the outbox, or a nudge to switch automation on.

The dashboard also carries the practice brief (a 3–4 sentence headline from live rows) and the first-run setup card until firm profile, first client, and automation are all done.

#### Move 2 — Engagements (`/workflow`)

Per-service work moving from documents → partner sign-off. Configuring an engagement seeds the statutory calendar with due dates for the current period, so filings appear on the calendar the moment the engagement exists.

#### Move 3 — Compliance (`/compliance`, `/notices`, `/dsc`, `/udin`)

The calendar is the firm's memory. Mark a filing done the moment you file it.

- **Filing calendar:** GST, TDS, ITR, ROC work with owners and due dates; overdue items rise to the top; ageing clock on every item.
- **Generate recurring work:** one click creates next month's GSTR-1/3B/9, TDS, ITR, audit or ROC tasks for every active client, duplicate-safe.
- **Notices:** enter the notice number, authority, amount, response deadline; the reply outline drafts from the notice record; status moves Open → In Progress → Responded → Filed; link the UDIN once filed.
- **DSC:** checked weekly; an expired token is a rejected filing; warnings at 30 days and 7 days.
- **UDIN:** record the real ICAI number; the register rejects duplicates for the same filing; search by client, date, filing type.

#### Move 4 — Documents (`/documents`, `/folders`)

Ask for papers against a client, then stop thinking about it.

1. Select a client, choose a document type (bank statement, Form 16, etc.).
2. Send the request — a pre-filled WhatsApp/email opens with the client's number and a standard message.
3. Wait for the upload; the client sends the file and it appears in the list.
4. Mark it **Verified**; the request closes and the ageing clock resets.
5. Anything older than five days shows as a chase; reminders are logged, so "we asked them three times" is a fact you can show.
6. Folders give client → financial year → category, with files in place.

#### Move 5 — Clients (`/clients`)

Search, open a client, and you get the whole relationship on one screen: fees due, open filings, pending documents, past proposals, what was last said. This is the screen to open before a client phone call.

- Edit and guarded delete (partner/manager).
- One-click reminder from the desk.
- PAN/GSTIN encrypted at rest; article staff cannot see them.

#### Move 6 — Fees (`/invoices`, `/timesheets`, `/reports`)

**Invoices:**

1. Raise the GST invoice — amount, 18% GST as CGST 9% + SGST 9%, SAC code, place of supply, description.
2. Print or share — letterhead view with firm GSTIN and address.
3. Record part payments as they arrive; the balance updates.
4. Record full payment with UPI reference; the invoice settles and the client's money position updates.
5. Ageing is computed, not typed; invoices past 30/60/90 days turn amber/red.
6. Send reminders — one-click pre-filled WhatsApp/email with invoice details and due date.

**Timesheets:** logged by the team, approved by a manager; feed utilisation and realisation.

**Reports:** the partner's questions — what is stuck, what is realised, who is overloaded, which client actually pays. Ageing, billed vs collected, realisation, staff utilisation, compliance health, client profitability, lead conversion. Export any register to CSV with deep links back to the record.

#### Move 7 — Grow (`/leads`, `/proposals`, `/campaigns`)

Enquiries are scored hot/warm/cold and assigned. Proposals generate from the lead in seconds (prospect/company name, entity type, services, fee), print/copy, and an accepted proposal converts into a client with no retyping — the lead is closed as Won. Campaigns send bulk, tokenised per-client messages with WhatsApp/email dispatch links.

#### Automation — the schedule behind the moves

If AI proposes an action, automation proposes the schedule. A partner writes a rule once in plain English — "chase documents after 5 days", "dun invoices after 30 days", "raise GSTR-3B for every client, monthly" — and the sweep runs it unattended.

- Two modes per rule: `auto` (executes, writes a run + audit entry) and `approval` (prepares a pending action for the copilot).
- Nothing is sent by the software: prepared messages wait in the outbox as `Queued`; a human opens the WhatsApp/email deep link and marks it sent. So "sent" always means a person sent it.
- Three ways to run: scheduled (Vercel Cron, `30 3 * * *`), operator Run now/Preview, and per-rule Run/Preview.
- Elapsed-time cadence means a missed day self-heals.
- The CA playbook ships as seven one-click presets with their rationale.

#### The end-to-end journey — from enquiry to realisation

| Stage | What happens | Your action |
|---|---|---|
| **1. Lead** | Enquiry lands (website, referral, walk-in) → scored Hot/Warm/Cold → assigned | Receive lead; assign to yourself or a team member |
| **2. Proposal** | Engagement proposal sent (scope, fee, GST) on call/WhatsApp | Generate from the lead; send; client accepts → lead marked Won |
| **3. Onboarding** | KYC, PAN, GSTIN, entity type, services → compliance calendar seeds itself | Enter client details; PAN/GSTIN encrypted at rest |
| **4. Documents** | Request via WhatsApp; client uploads; chase stops when received | Send request; wait for upload; mark Received |
| **5. Compliance** | Statutory calendar with deadlines; owners assigned; overdue detection | Review calendar; ensure owners know their deadlines |
| **6. Notices** | IT/GST/ROC notices logged; reply outlines drafted; UDIN filed | Enter notice; use AI draft reply; file response with UDIN |
| **7. Collections** | Invoices issued; payments recorded; ageing tracked; reminders on WhatsApp | Issue invoice; record payments; send reminders when overdue; close when fully paid |

#### Concrete example — M/s Aurora Textiles

1. **Lead** enters from the website → assigned to you.
2. **Proposal** generated → sent on call → client accepts → lead marked Won.
3. **Onboarding** → PAN (encrypted), GSTIN (encrypted), services (GST filing, TDS, audit) → compliance calendar auto-creates due dates.
4. **Documents** → request "Last 2 years bank statements" via WhatsApp → client uploads → mark Received → chase stops.
5. **Compliance** → GSTR-3B due 20th July, TDS 26Q due 31st July, ITR due 31st Oct — all with owners assigned.
6. **Notices** → if an Income Tax notice arrives, enter it → AI drafts a reply outline → file the response with the UDIN.
7. **Collections** → first invoice at 18% GST → record payment when received → if 30 days overdue, send a WhatsApp reminder → close the invoice when fully paid.

#### Where everything lives (when the rail is collapsed)

| You are looking for | Where it lives |
|---|---|
| Notices, DSC, UDIN | **Compliance** (tab strip, or expanded rail) |
| Reports, Timesheets | **Fees** (tab strip, or expanded rail) |
| Proposals, Campaigns | **Grow** (tab strip, or expanded rail) |
| AI copilot | **Copilot** in the rail, **Ask copilot** on the dashboard, or `Ctrl+J` anywhere |

#### Month-end checklist

1. Compliance calendar: everything filed for the month, marked done.
2. Invoices raised for the month's work; timesheets approved.
3. Outbox cleared — every prepared chaser either sent or dismissed.
4. Reports → receivables ageing: anything past 60 days gets a call, not an email.
5. Automation → run history: confirm the daily sweep ran and did what you expect.

#### Data, safety, and what to expect

- Client PAN and GSTIN are encrypted at rest; passwords are salted and hashed.
- Every sign-in, change, and automation run is written to an audit trail.
- Export any register to CSV at any time, so the firm is never locked in.
- The AI never sends a message, never executes a write without approval, and never sees identifiers — only counts, amounts, dates, and names.

#### One caveat, stated plainly

The public demo deployment runs on ephemeral storage, so records entered there can be lost when the instance recycles. Use it to evaluate the workflow. For real client records, run the app where `CA_DATA_DIR` points at a persistent volume, and take the CSV exports until that is in place.

---

## 5. Reading the source of truth

If you need the exact design record rather than this summary:

- AI layer design: `docs/AI-LAYER.md`
- Automation design: `docs/AUTOMATION.md`
- Market research, audit, and roadmap: `REPORT.md`
- Client-facing SRS: `CADocs-Client-SRS.md`
- Staff-facing how-to: `docs/HOW-TO-USE.md`
- Public reference: `README.md`

---

*This report synthesises `CADocs-Client-SRS.md`, `REPORT.md`, `README.md`, `docs/HOW-TO-USE.md`, `docs/AI-LAYER.md`, `docs/AUTOMATION.md`, and the live source tree (including `lib/nav.ts`, `lib/ai-agent.ts`, `lib/ai-tools.ts`, `lib/automation.ts`, `lib/crypto.ts`, `lib/types.ts`, `lib/db.ts`, `app/layout.tsx`, `proxy.ts`, `package.json`, `vercel.json`, and `scripts/deploy.sh`), verified against the running app at https://cadocs-ca.vercel.app on 24 October 2026.*
