# CADocs

A full rebuild of the CA-automation project as a modern fullstack Next.js application. The original vanilla-JS SPA plus Express API backed by Google Sheets has been migrated to **Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4** with a **local SQLite** store, so it runs end-to-end with no external credentials.

This release adds an **AI copilot layer** (multi-provider, free-tier capable, works fully keyless) and a **security release**: password sign-in with partner/manager/article roles, server-side session revocation, encrypted PAN/GSTIN at rest, CSRF and rate-limit defences, hardened response headers and a public privacy notice.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm run start        # http://localhost:3000
```

Requires **Node.js 24+** (the data layer uses the built-in `node:sqlite` module).

**First run:** three role-tiered accounts are created automatically and their generated passwords are written once to `.data/bootstrap-credentials.txt` (mode 0600). Sign in, then change each password in Settings → Security and delete that file. Set `ADMIN_PASSWORD` / `MANAGER_PASSWORD` / `STAFF_PASSWORD` before first boot to choose your own instead.

**Optional environment:**

| Variable | Effect |
| --- | --- |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY` | Enables LLM features (first key found wins, in that order — all have free tiers). Without any key the AI layer answers from deterministic practice data. |
| `AI_DAILY_LIMIT` | Tool-calling budget per user per day (default 80, min 5). Quota errors return 429. |
| `GEMINI_BASE_URL`, `GROQ_BASE_URL`, `OPENROUTER_BASE_URL`, `NVIDIA_BASE_URL` | Optional origin override for a provider — point at a self-hosted OpenAI-compatible gateway (Ollama, LiteLLM, llama.cpp) or a test double. |
| `FIELD_ENCRYPTION_KEY`, `SESSION_SECRET` | Override the auto-generated AES key / session-signing key (otherwise created in `.data/`, mode 0600). |
| `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `STAFF_PASSWORD` | Set first-run passwords instead of generating them. |

## What is in the app

| Module | Route | What it does |
| --- | --- | --- |
| Dashboard | `/` | KPIs, revenue chart, pipeline, urgent deadlines, activity feed |
| AI Copilot | `/agent` | Practice-aware chat over live data (Groq optional) |
| AI palette | `⌘J` / `Ctrl+J` (any page) | Global assistant: answers with a tool-call trace; writes wait for explicit approval |
| Documents | `/documents` | Client document requests, file upload/download (8 MB, allow-listed types), received/verified workflow, logged chase reminders |
| Compliance | `/compliance` | Filing calendar with due dates, overdue detection, mark-filed, one-click recurring task generation for many clients |
| Leads | `/leads` | Scored pipeline, stage changes, conversions |
| Proposals | `/proposals` | Generates partner-ready engagement proposals from a lead, print/copy, status flow that advances the lead |
| Campaigns | `/campaigns` | Bulk reminders per audience with tokenised per-client messages and WhatsApp/email dispatch links |
| Invoices | `/invoices` | GST invoices (CGST/SGST split, SAC, place of supply), print view, partial/full payment recording with history, overdue detection, CSV export |
| Clients | `/clients` | Client master plus a 360° panel: balances, open compliance, pending documents, invoices, proposals, logged reminders; edit and guarded delete |
| Reports | `/reports` | Receivables ageing, billed vs collected, realization, staff utilization, compliance health, client profitability, lead conversion, CSV exports |
| UDIN Register | `/udin` | Real ICAI UDIN capture (not fabricated), duplicate rejection, copy/delete |
| DSC Tracker | `/dsc` | Token validity with expiring-soon detection |
| Notices | `/notices` | Notices, deadlines, response status |
| Timesheets | `/timesheets` | Billable hours with approval flow |
| Settings | `/settings` | Firm profile, AI provider/toggle, password rotation, role explainer, firm accounts (partner) |
| Sign in | `/login` | Password sign-in with rate limiting and audit of attempts |
| Privacy notice | `/privacy` | Public DPDP-aligned notice: storage, encryption, AI data flows, retention |

All fifteen modules are server-rendered from SQLite and mutate through REST route handlers, with `router.refresh()` keeping the shell badges and lists in sync. A `messages` table records every reminder opened from the app (WhatsApp/email deep link), so "chased" is an auditable fact rather than a toast.

## AI layer (above every module)

The AI sits **on top of the whole application** as one shared layer, not as per-module features. Three surfaces call the same agent:

1. **Global palette** (`⌘J`, every page) — ask anything in natural language; the reply carries a trace of the tools it used.
2. **Module assists** — contextual one-click buttons: client 360 brief (`/clients`), week plan (`/compliance`), collection plan (`/invoices`), notice reply outline (`/notices`).
3. **Copilot page** (`/agent`) — free-form chat over the practice.

**How it runs** (`lib/ai-agent.ts`):

- **Bounded tool loop** — a model may call at most 8 tools across 4 rounds. Reads execute inline; the **first write becomes a pending `ai_action`** that nothing executes until a human approves it.
- **13 typed tools** (`lib/ai-tools.ts`) — `practice_overview`, `find_client`, `client_360`, `list_deadlines`, `list_pending_documents`, `list_overdue_invoices`, `revenue_summary`, `utilization_summary`, `pipeline_summary`, `get_notice`, plus the write tools `request_document`, `create_compliance_task`, `log_reminder`. Every tool re-validates its arguments on execution; the model's arguments are never trusted just because the model produced them.
- **Role scoping** — tools are filtered by role (`partner` / `manager` / `article`). Article assistants get reads only and are told plainly they cannot create records. An approval re-checks ownership, pending status, the approver's role, schema validation and domain validation, then executes — so a different user's pending action returns 404 and re-approving an executed action returns 409.
- **Keyless by design** — with no provider key the same tool registry is driven by a deterministic intent router (`Plan my week`, `Who owes us the most?`, `request … from <client>`, `create <filing> for <client> due <date>`, `remind <client> about …`), and each module assist has its own deterministic answer. The product never depends on a network call to work.
- **Quota + audit** — every call is metered per user per day (`AI_DAILY_LIMIT`, default 80) and written to `ai_calls` with the tools used, rounds, latency and status. Proposals and decisions land in `ai_actions` and surface in the audit feed.

**Privacy**: the model never executes a write, never sees PAN/GSTIN (stripped server-side), and only receives aggregate practice facts — counts, amounts, due dates and names. `ai_enabled` in Settings is a hard kill-switch.

### AI copilot (free-tier, keyless-safe)

- **Multi-provider layer** (`lib/ai.ts`): Gemini, Groq, OpenRouter or NVIDIA NIM — whichever key is present, first match wins. Timeout-guarded, never throws; failures fall back silently to deterministic answers.
- **Practice copilot** (`/agent`): markdown answers over live compliance, billing, document and pipeline data, with the active provider disclosed in the header.
- **Practice brief**: every dashboard load generates a 3–4 sentence brief from live rows; with a provider it is rewritten for readability under a hard "never change a number" rule.
- **Chase drafting**: the reminder modal can rewrite a WhatsApp/email chaser in the firm's tone before you send it.
- **Document classification**: the document-request form suggests a category and filename (keyword rules keyless; LLM when configured).
- **Insights engine** (`lib/insights.ts`): deterministic rules for receivables concentration, overdue clusters, stalled documents, collection risk, utilization, DSC expiry, notice deadlines and untouched pipeline — each with a direct action link.

Privacy guardrails: `ai_enabled` in Settings is a hard kill-switch; only aggregate facts (counts, amounts, due dates, names) are ever sent; PAN/GSTIN-shaped tokens are stripped from every prompt server-side; documents, passwords and identifiers are never included; each supported provider's terms exclude training on API inputs.

## Security & privacy

- **Auth**: scrypt-hashed passwords with per-user salts; HMAC-signed httpOnly session cookies (12h, SameSite=Lax); every sign-in, failed attempt, logout and password change is audited.
- **Roles enforced server-side** by `proxy.ts` on every request: partner (all), manager (operations + billing, no settings/users/client deletes), article (read-only + own timesheets, messages, AI).
- **Revocation**: logout and password changes bump a per-user token version, instantly invalidating every outstanding cookie — replaying a stolen session file returns 401.
- **Encryption at rest**: client PAN and GSTIN are AES-256-GCM encrypted in SQLite with a machine-local key; decryption happens only in the DB mapping layer. Legacy plaintext rows are migrated on boot.
- **CSRF & abuse**: cross-origin mutations are rejected (Origin check), login attempts are limited per IP+username (10 / 15 min), writes are limited per user (300 / min), AI calls per IP.
- **Headers**: CSP, `X-Frame-Options: DENY`, nosniff, strict referrer, permissions policy, opener isolation, HSTS in production.
- **Data rights**: CSV export for every register (access/portability), client edit (correction), guarded cascading delete (erasure), audit trail (accountability). See `/privacy`.

## Architecture

```
app/
  layout.tsx            app shell (sidebar, topbar, mobile nav, toasts)
  page.tsx              dashboard (server component)
  <module>/page.tsx     one route per module, dynamic + server-rendered
  api/<module>/route.ts REST handlers (GET/POST/PATCH/PUT/DELETE)
components/
  shell.tsx             navigation and topbar
  ui.tsx                design system primitives
  interactive.tsx       modals, toasts, global search
  views/*.tsx           client views for each module
  ai-command.tsx        global ⌘J assistant palette with tool trace and approve/reject
  ai-assist.tsx         contextual module assist button + result sheet
  markdown.tsx          markdown renderer shared by the agent surfaces
lib/
  db.ts                 schema, seed, typed queries, audit log, encrypted identifiers
  proposals.ts          deterministic proposal document generator
  api.ts                request validation helpers
  crypto.ts             AES-GCM field encryption, scrypt passwords, session tokens, rate limiter
  auth.ts               session resolution and the central role policy
  ai.ts                 multi-provider LLM layer with privacy guardrails
  ai-agent.ts           the practice agent: bounded tool loop, approval proposals, keyless router
  ai-tools.ts           13 typed tools with validators and role scoping
  ai-prompts.ts         versioned prompts for the agent and the module assists
  insights.ts           deterministic practice-insight engine
  format.ts, types.ts   formatting and shared types
proxy.ts                auth gate, role policy, CSRF and rate limits (Node.js runtime)
```

- **Data**: SQLite file at `.data/ca-suite.db` (auto-created and seeded with 12 clients, 20 compliance tasks, leads, invoices, payments, notices, DSC, UDIN, timesheets, proposals and a campaign). Uploaded client files live in `.data/uploads/` and are never served as public assets. Delete the `.data` directory to reset to a clean demo dataset.
- **Identifiers**: sequential IDs use `MAX(suffix)+1` (not `COUNT(*)`), so deleting a record can never resurrect an ID; payments are numbered per invoice (`PAY-INV-2026-013`, `-2` for splits).
- **API**: every endpoint validates input in `lib/api.ts` and returns JSON errors with proper status codes.
- **Audit trail**: creates and status changes are written to `audit_log` and surface in the dashboard feed.
- **Derived status**: compliance, invoice and DSC statuses are computed from dates on read, so "overdue"/"expiring" stays correct without a cron job.

## API surface

`GET/POST /api/{clients,leads,compliance,documents,invoices,payments,messages,udin,dsc,notices,timesheets,proposals,campaigns}`
`GET/PATCH/DELETE /api/{module}/[id]` where applicable (clients support PATCH + guarded DELETE)
`GET /api/dashboard`, `GET /api/reports`, `GET /api/settings` + `PUT`, `GET /api/search?q=`, `GET /api/health`
`POST /api/auth/login`, `POST /api/auth/logout`, `PATCH /api/auth/password`, `GET/POST /api/users` (partner)
`POST /api/ai/chat`, `GET /api/ai/brief`, `POST /api/ai/draft`, `POST /api/ai/classify`
`POST /api/ai/agent` (ask), `POST /api/ai/assist` (module assist), `POST /api/ai/actions/[id]` (approve/reject), `GET /api/ai/usage` (quota + recent calls)
`GET /api/export?type={clients,invoices,payments,compliance,documents,timesheets,leads}` streams UTF-8 CSV
`POST /api/documents/[id]/file` (multipart upload), `GET /api/documents/[id]/file` (download), `DELETE` (detach)
`POST /api/compliance/generate` (recurring tasks, duplicate-safe), `POST /api/proposals/[id]/convert` (idempotent client creation)

## Performance

Measured locally against the production build (`next start`), warm cache, on the seeded database:

- TTFB **13–62 ms** per page, full HTML response **14–66 ms**
- Payloads **45–112 KB** including the React Server Component stream
- Fonts self-hosted via `next/font` (zero requests to Google Fonts, no layout shift)
- The app shell queries only `COUNT(*)` aggregates for nav badges instead of loading every table on each navigation
- SQLite runs in rollback-journal mode so reads never touch the project tree (WAL's shared-memory writes make the dev file watcher recompile in a loop)

## Deployment (Vercel)

Live at **https://cadocs-ca.vercel.app** (project `cadocs`, production branch of this checkout).
The clean name `cadocs.vercel.app` was already registered to another Vercel account, so the
project uses `cadocs-ca`.

Environment variables set in Vercel (production + preview):

| Variable | Why |
| --- | --- |
| `SESSION_SECRET` | HMAC key for the auth cookie — must be stable across instances, so it cannot be generated per cold start |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM key for PAN/GSTIN columns |
| `ADMIN_PASSWORD`, `MANAGER_PASSWORD`, `STAFF_PASSWORD` | Seed passwords for the three role accounts (≥ 8 chars) |
| `CA_DATA_DIR` | `/tmp/ca-suite` — the only writable path on a serverless host |

`lib/data-dir.ts` is the single source of truth for runtime state (SQLite file, keys, uploads).
Locally it resolves to `.data/`; when `VERCEL` is set it falls back to `/tmp`. **`/tmp` is
per-instance and ephemeral**, so writes on the deployed site are not shared between function
instances (a burst test showed 4 of 24 requests hitting a fresh instance) and are lost on cold
start. The deployed site is therefore a working demo, not a multi-user store — point
`CA_DATA_DIR` at a real volume or move the data layer to a hosted database before using it for
genuine client records.

Redeploy with `vercel deploy --prod` (or push to the linked project).

## Public site (marketing)

The product site for clients and prospects lives at **`/site`** and is public
(listed in `lib/auth.ts` → `isPublicPath`). Visitors who open `/` are redirected
there; the workspace itself is untouched and still gated — `/invoices` and every
other app route still bounce to `/login` when there is no session. Signed-in
staff can open `/site` and get the site without the practice shell wrapped
around it (the root layout drops the shell for that path, seen through the
`x-pathname` header `proxy.ts` forwards).

- **Copy and numbers:** `lib/site-content.ts` — hero, workflow stages, use
  cases, modules, roles, security claims, plans and FAQs. Nothing is buried in
  components.
- **Animations:** `components/site/anim.tsx` (reveals, zoom in/out, counters,
  typing, the fitted design canvas) and `components/site/mockups.tsx` — screens
  built from the app's own `Card`/`Stat`/`StatusPill`/`Progress` primitives so
  the marketing site and the product look like the same product.
- **The workflow story:** `components/site/workflow.tsx` — seven stages driven
  by scroll position, with the incoming screen zooming in and the outgoing one
  zooming out; phones get stacked, looping cards instead of a sticky stage.
- **Action cursor:** `AppFrame` renders a pointer that travels to the control a
  screen is describing and clicks it (`useCursor().move('[data-cursor="…"]')`).
- **Lead capture:** `components/site/demo-form.tsx` posts to
  `POST /api/public/demo-request`, which validates, scores and writes a real
  lead (source *Website demo request*) into the Leads module. It is rate limited
  to 5 requests per IP per 10 minutes, carries a honeypot field, and refuses
  cross-origin posts.
- **Every animation respects `prefers-reduced-motion`**, and the reveal/counter
  primitives fall back to timers when a browser never delivers animation frames.

Placeholders to replace before this is used as a sales site: `TESTIMONIALS` in
`lib/site-content.ts` is empty on purpose (add real quotes and the section
appears), and the plans carry no prices — they are described by firm size and
quoted on the call.

## Migration notes

| Legacy | Now |
| --- | --- |
| `index.html`, `app.js`, Express `backend/routes/*` | App Router pages + route handlers |
| Google Sheets service layer | SQLite (`node:sqlite`) with typed queries and seeding |
| JWT login / user roles | scrypt password auth, HMAC sessions with revocation, partner/manager/article roles enforced in `proxy.ts` |
| Gemini/Groq AI helpers | Copilot endpoint with optional Groq and a deterministic practice-data fallback; proposal generator is deterministic |
| WhatsApp / email / Telegram / Razorpay / R2 | Local records plus one-click `wa.me` / `mailto` dispatch links; no provider keys needed |
| Scheduler reminders | Deadline-first dashboard and campaign audiences computed on demand |

The original downloaded source remains in `CA-automation-main/` for reference.
