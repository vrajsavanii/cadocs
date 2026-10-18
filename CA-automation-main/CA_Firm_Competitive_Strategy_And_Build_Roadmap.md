# CA Firm Automation Suite
## Full Competitive Strategy, Feature Upgrade Plan & AI Prompt Bible
**Prepared for:** Vraj | Qudrat Technologies  
**Date:** September 20, 2026  
**Version:** 1.0 — Confidential Working Document

---

## PART 0: HOW TO USE THIS DOCUMENT

This document is split into four parts:

1. **Competitive Landscape** — What you are up against, competitor pricing, gaps you can exploit
2. **Feature Gap Analysis** — What your current SRS is missing vs. what CAs actually pay for
3. **Full Build Roadmap** — Prioritized phases to make your software genuinely sellable
4. **AI Prompt Bible** — Production-ready prompts for every AI feature in the platform

Read Part 1 and 2 first to understand *why* the roadmap is ordered the way it is. Then use Part 4 as the engineering reference — copy prompts directly into your `backend/ai/` modules.

---

## PART 1: COMPETITIVE LANDSCAPE DEEP ANALYSIS

### 1.1 The Indian CA Software Market in 2026

The Indian CA software market has approximately 3.5 lakh practising Chartered Accountants, with the majority running firms of 2–15 staff. The market is segmented into:

- **Practice Management** (tasks, compliance calendar, billing) — ₹6,000–₹35,000/year per firm
- **GST Filing** (reconciliation, portal filing) — ₹10,000–₹25,000/year per firm
- **Audit Tools** (working papers, sampling) — ₹15,000–₹50,000/year per firm

Most firms pay for 2–3 of these separately. A unified platform that handles all three at the right price wins.

---

### 1.2 Top Competitors — Feature & Pricing Matrix

| Competitor | Core Strengths | Key Weaknesses | Pricing (2026) |
|:---|:---|:---|:---|
| **Turia** | WhatsApp automation, lead pipeline, DSC register, full feature parity at every plan | Per-user pricing gets expensive for 10+ users; no GSTN portal auto-fetch | ₹6,999/yr (5 users) → ₹34,999/yr (60 users) |
| **Jamku** | Compliance dashboard, task management, established user base, desktop app | Poor UI per reviews, weak AI, no WhatsApp Business API, dated UX | ₹6,500/yr (5 users) + ₹3,000 setup |
| **QwikCA** | GST portal status pull, UDIN register, Kanban board, DSC expiry alerts | New entrant; billing module weak; no notice management; heavy SEO presence, light product | ₹2,950/org/month (small) |
| **Finexo** | Auto-creates compliance tasks from QRMP status, 1,500+ CA firms, flat team pricing | No mobile app, no sales CRM, no UDIN generation, no proposals | ₹5,999/yr (10 users) |
| **ATOM by Vider** | GST + IT portal auto-fetch, notice management, litigation tracking, Forbes India recognised | Complex interface; expensive for small firms; steep learning curve | Custom / Premium |
| **PracticeStacks** | Proposals with OTP e-signatures, WhatsApp Business API, client self-serve portal | Newer product; premium pricing at ₹749/month | ₹749/month (5 users) |
| **Zoho Practice** | Zoho ecosystem integration, mature billing | Not India-specific; no GST portal pull; generic | ₹2,950+/org/month |
| **KDK Spectrum Cloud** | Bulk GSTR filing, 1.5 lakh+ CA users, reconciliation engine | Filing tool, NOT practice management; no client CRM | ₹10,000–₹25,000/yr |
| **ClearTax GST** | Fastest GSTR-2B reconciliation, 6,000+ returns/batch, portal integration | Only GST; no task management, billing, or client CRM | Custom/Premium |

---

### 1.3 Critical Market Gaps (Where CAs Have No Good Option)

#### GAP 1: Notice Management + Auto-Fetch
No affordable practice management tool auto-fetches GST and Income Tax notices for all clients simultaneously. CAs find out about notices only when clients forward screenshots. This is a **₹10–15 crore problem** — missed notices cost firms clients.

#### GAP 2: Specific Document Reminders (Not Generic Ones)
Current tools send "please send documents" — WhatsApp messages that get ignored. CAs need: *"GSTR-3B for July needs: Purchase Register (pending), Bank Statement Aug (pending). Due in 4 days. Penalty: ₹50/day."* Specificity = responses.

#### GAP 3: Client Self-Serve Portal Without a Password
Every CA firm faces this: the document arrived on WhatsApp, and 3 weeks later nobody can find it in a 400-message group chat. The fix is a magic-link client portal (no login/password = zero support tickets) where clients upload against named checklist items.

#### GAP 4: AI That Knows Indian Law + Client Data Together
Existing tools use AI generically. CAs want an assistant that answers: *"What is Priya Trading's GSTR-1 filing status for June, and what penalty applies if we miss tomorrow?"* — combining real client data with actual Indian statute knowledge.

#### GAP 5: UDIN + DSC Register in an Affordable Plan
UDIN tracking and DSC expiry management are locked behind premium tiers in most competitors. These are critical workflow tools for every CA, even solo practitioners.

---

### 1.4 Your Competitive Positioning

**Your current software** covers: compliance calendar, document hub, invoice recovery, lead pipeline, WhatsApp AI agent, multi-channel reminders.

**Your unfair advantages:**
- Groq LPU speed (< 2 second AI response) — faster than any competitor
- WhatsApp + Email + Telegram multi-channel (competitors have 1–2 channels)
- AI Co-Pilot that reads live client data from Sheets
- Free/zero-cost infrastructure (can price aggressively)
- Built by practitioners, not generic SaaS teams

**Where you are currently exposed:**
- Google Sheets backend (not credible to enterprise buyers — needs PostgreSQL/Supabase)
- No JWT authentication (single dashboard = deal-killer for multi-CA firms)
- No client self-serve portal (magic-link upload)
- No GSTN/IT portal notice auto-fetch
- No UDIN register
- No DSC expiry tracking
- No proposal / engagement letter generation with e-signature
- No audit trail / immutable log (ICAI requirement)

---

## PART 2: FEATURE GAP ANALYSIS

### 2.1 Features CAs Are Ready to Pay For (Priority Order)

| Priority | Feature | Why CAs Pay | Competitor Gap |
|:---|:---|:---|:---|
| 🔴 P0 | **JWT Auth + Role-Based Access** | Firms CANNOT share a single open dashboard with articles/junior staff | All serious competitors have this |
| 🔴 P0 | **Audit Trail / Change Log** | ICAI SA-230 requirement; partners need to see who changed what | Jamku/Turia have it; you don't |
| 🔴 P0 | **Supabase/PostgreSQL Migration** | Google Sheets crashes at 500+ rows concurrently; breaks trust with CAs | All competitors use proper DBs |
| 🟡 P1 | **Client Self-Serve Portal (Magic Link)** | Eliminates WhatsApp document chaos; huge pain point | Only PracticeStacks has this well |
| 🟡 P1 | **UDIN Register** | Every CA generating audit reports must log UDIN; ICAI mandates it | QwikCA and Turia have it |
| 🟡 P1 | **DSC Expiry Tracker + Alerts** | DSC expires silently and paralyzes filing | QwikCA, ATOM, Turia have it |
| 🟡 P1 | **Notice Inbox (GST + IT)** | Auto-fetch notices from portals for all clients | Only ATOM has this; expensive |
| 🟢 P2 | **Proposal + Engagement Letter** | Win new clients with professional proposals; OTP e-sign = close faster | Only PracticeStacks has it |
| 🟢 P2 | **GSTR-2B vs Books Reconciliation** | Core audit work; CAs spend 30% of time on this manually | ClearTax, KDK, ExpressGST |
| 🟢 P2 | **Staff Attendance + Timesheet** | Practice management = managing people too | Turia, Jamku, ATOM have it |
| 🔵 P3 | **Mobile App (Android)** | Article assistants work on phones; Web is desktop-only | Jamku, Turia, QwikCA have apps |
| 🔵 P3 | **Bulk WhatsApp Blast (Compliance Season)** | Send 200+ reminders in one click during peak filing months | Turia, Jamku have bulk SMS/email |
| 🔵 P3 | **Razorpay Payment Links in Invoice** | Let clients pay directly from the WhatsApp message | PracticeStacks has it |
| 🔵 P3 | **QRMP Auto-Detection** | Know which clients are QRMP vs monthly filers automatically | Finexo's core differentiator |

---

## PART 3: FULL BUILD ROADMAP

### Phase 0 — Fix Before You Sell (2 Weeks)

**0.1 — JWT Authentication + 4-Role RBAC**
- Implement JWT tokens with 7-day expiry + refresh tokens
- Gate every API route with `requireRole(['partner', 'manager'])` middleware
- Add login page with "Forgot Password" via email OTP
- **Tech:** `jsonwebtoken`, `bcrypt`, email OTP via Nodemailer

**0.2 — Migrate to Supabase (PostgreSQL)**
- Migrate 7 schema tabs to Supabase tables
- Use Row Level Security (RLS) for role-based data isolation
- Keep Google Sheets as an export option only
- **Zero-cost:** Supabase free tier handles 500MB + 50,000 MAUs

**0.3 — Append-Only Audit Log**
- `audit_logs` table: `(id, user_id, action, entity_type, entity_id, old_value, new_value, timestamp)`
- Every write operation calls `logAudit()` before executing

**0.4 — Input Sanitization Audit**
- Run `npm audit` and fix all critical CVEs
- Validate all form inputs server-side (Joi or Zod)

---

### Phase 1 — Core Differentiators (4 Weeks)

**1.1 — Client Self-Serve Magic Link Portal**
- Unique magic link per client: `https://yourapp.com/portal/CLIENT-001?token=<signed-jwt-24hr>`
- Client sees: compliance deadlines, document upload interface, Pay Now button
- Gemini Vision auto-classifies uploaded documents
- Staff gets Telegram notification on upload

**1.2 — UDIN Register**
- Table: `udin_records` (client_id, ca_member_no, udin, document_type, financial_year, etc.)
- Validate UDIN format; CSV export; monthly dashboard count

**1.3 — DSC Expiry Tracker**
- Table: `dsc_records` (client_id, dsc_holder_name, class_type, valid_from, valid_until, etc.)
- Cron at 08:00 AM: Alert on DSCs expiring in 30/15/7 days

**1.4 — Specific Document Reminder Engine**
- Context-aware reminders naming exact missing docs with penalty amounts
- Not generic "please send documents"

**1.5 — Notice Inbox (MVP)**
- Manual notice intake with deadline countdown and auto-alerts
- Phase 2: Puppeteer portal scraper

---

### Phase 2 — Revenue Multipliers (4 Weeks)

**2.1 — Proposal + Engagement Letter Generator**
- AI-drafted proposals with OTP e-signature
- PDF generated via pdfkit or puppeteer

**2.2 — GSTR-2B vs Purchase Register Reconciliation**
- Gemini Vision processes GSTR-2B JSON + Purchase Register
- Match by GSTIN + Invoice Number + Amount ±1%
- One-click supplier WhatsApp for mismatches

**2.3 — Staff Attendance + Timesheet Module**
- Clock-in/out, task-level time logging, billable hours report

**2.4 — Bulk Communication Blast**
- Mass reminders by compliance type + status filter

**2.5 — Razorpay Payment Links in Invoices**
- Auto-generate UPI+Card payment links; webhook auto-marks invoice paid

---

### Pricing Strategy

| Plan | Users | Annual Price | What It Includes |
|:---|:---|:---|:---|
| **Starter** | 1–5 | ₹5,999/yr | All core features (compliance, docs, invoices, AI, WhatsApp) |
| **Growth** | 6–15 | ₹12,999/yr | Starter + UDIN, DSC, Notice inbox, Magic-link portal |
| **Professional** | 16–40 | ₹22,999/yr | Growth + Proposals, Reconciliation, Timesheets, Bulk blast |
| **Enterprise** | 40+ | Custom | Full suite + dedicated onboarding + SLA |

---

## PART 4: AI PROMPT BIBLE

### 4.1 WhatsApp AI Support Agent
**File:** `backend/ai/supportAgent.js`

**System Prompt:**
```
You are the AI assistant for an Indian Chartered Accountancy firm called "${firmName}". 
You assist clients over WhatsApp with their tax and compliance queries.

FIRM RULES:
- Always respond in the same language the client uses (English, Hindi, or Hinglish)
- Keep responses under 4 lines unless specifically asked for more detail
- Never make up deadlines — only use the compliance data provided
- Never give legal opinions — recommend consulting the CA partner for complex matters
- If a question is outside compliance/tax/documents, politely decline and offer to connect the client to the partner

CLIENT CONTEXT (injected at runtime — treat as authoritative):
Client Name: ${clientName}
Client ID: ${clientId}
Entity Type: ${entityType}
GST Number: ${gstIn}
PAN: ${pan}
Active Compliance Items: ${complianceItemsJSON}
Missing Documents: ${missingDocsJSON}
Outstanding Invoices: ${outstandingInvoicesJSON}

RESPONSE FORMAT:
- Use WhatsApp formatting: *bold* for key terms, line breaks for lists
- Always sign off as "— ${firmName} Team"
- If escalation is needed, say: "I'll flag this for our CA partner to call you within 24 hours."
```

---

### 4.2 Lead Qualification + Scoring Engine
**File:** `backend/ai/leadQualifier.js`

**System Prompt:**
```
You are a lead qualification engine for an Indian CA firm. 
Analyze incoming lead data and return a JSON object with lead scoring and recommendations.

You must return ONLY valid JSON. No preamble. No explanation. No markdown.

Score the lead from 0–100 based on:
- Entity type: Pvt Ltd/LLP = +30, Partnership = +20, Proprietorship = +15, Individual = +5
- Annual turnover: >5 crore = +25, 1–5 crore = +20, 50L–1 crore = +15, <50L = +5
- Compliance complexity: Statutory audit + GST + ITR + ROC = +25; GST + ITR only = +15
- Timeline urgency: Immediate = +10, 1 month = +7, 3 months = +3
- Number of services required: 4+ = +10, 2–3 = +5, 1 = +0

Return this exact JSON structure:
{
  "leadScore": 78,
  "category": "Hot",
  "estimatedMonthlyFee": "₹12,000–₹18,000",
  "primaryServices": ["GST Filing", "Statutory Audit", "ROC Compliance"],
  "recommendedNextAction": "Call within 24 hours. High-value Pvt Ltd client with full compliance requirement.",
  "proposalPoints": ["Monthly GSTR-1/3B filing", "Annual GST audit (GSTR-9C)", "Income Tax (ITR-6)", "ROC Annual Filing (AOC-4, MGT-7)", "TDS Compliance (26Q quarterly)"],
  "redFlags": ["No existing CA mentioned — may be switching; ask why."],
  "estimatedAnnualValue": "₹1,44,000–₹2,16,000"
}
```

---

### 4.3 Context-Aware Message Drafter
**File:** `backend/ai/draftMessages.js`

**System Prompt:**
```
You are a professional communication specialist for Indian CA firms. 
Draft concise, legally aware, and relationship-respecting messages for client communication.

FIRM DETAILS:
Firm Name: ${firmName}
CA Partner Name: ${partnerName}
Firm Phone: ${firmPhone}

CLIENT DETAILS:
Client Name: ${clientName}
Entity Type: ${entityType}
Client Since: ${clientSince}

MESSAGE TYPE: ${messageType}
[Options: compliance_reminder | overdue_warning | document_request | payment_reminder | payment_thanks | proposal_followup | filing_confirmation]

RULES:
- For WhatsApp: Keep under 150 words. Use *bold* for key facts. Professional but warm tone.
- For Email: Subject line first on its own line prefixed "SUBJECT:". Body up to 250 words. Formal but not cold.
- Never threaten legal action. Never be rude. Always offer to help.
- Include actual penalty amounts when overdue_warning type.
- Include specific document names when document_request type.
- Never invent data not provided below.

COMPLIANCE/INVOICE DATA:
${contextDataJSON}
```

---

### 4.4 AI Tax Co-Pilot (In-App Staff Assistant)
**File:** `backend/ai/coPilot.js`

**System Prompt:**
```
You are an expert Indian tax and compliance assistant for Chartered Accountancy firm staff.
You assist CA partners, managers, and article assistants with:
- Indian tax law queries (Income Tax Act 1961, CGST Act 2017, Companies Act 2013)
- GST compliance procedures and form details
- TDS rates, sections, and filing procedures
- ROC/MCA filing requirements
- ICAI guidelines and SA standards

KNOWLEDGE STANDARDS:
- Cite the exact section, rule, or notification for every legal answer
- If a rate/limit may have changed via recent notification, say so and advise verification
- Distinguish between GST rates, exemptions, and RCM applicability clearly
- For penalty queries, provide the exact statutory formula (not estimates)
- For ITR queries, identify the correct ITR form based on entity type and income sources

FIRM CONTEXT (for client-specific queries):
${clientContextJSON || "No client selected — answering general query."}

RESPONSE FORMAT:
- For complex queries: Structure as → Answer → Statutory Reference → Example (if helpful)
- For simple rate queries: One direct answer + section
- For client-specific queries: Reference actual client data, never assume
- Always end with: "⚠️ Verify with latest CBIC/CBDT circular before filing."

STRICT RULES:
- Never provide advice that could be construed as legal opinion for litigation
- If the query is about a specific client's case with disputes, recommend the partner handle it
- Do not discuss competitor CA firms or their practices
- Do not speculate on GST Council decisions not yet notified
```

---

### 4.5 Gemini Vision — Document Classifier & Data Extractor
**File:** `backend/ai/documentIntel.js`

**Classification Prompt (sent with image/PDF page):**
```
You are a document intelligence engine for an Indian CA firm.
Analyze the document image provided and return ONLY valid JSON. No explanation.

{
  "documentType": "<bank_statement | gst_invoice | purchase_invoice | form_16 | form_26as | gstr_2b | itr_v | balance_sheet | profit_loss | tds_certificate | aadhaar | pan_card | rent_agreement | salary_slip | other>",
  "documentPeriod": "<month/year or financial year if visible, else null>",
  "entityName": "<name of individual or company on document, else null>",
  "pan": "<PAN number if visible, else null>",
  "gstin": "<GSTIN if visible, else null>",
  "totalAmount": "<total amount in INR as number, else null>",
  "invoiceNumber": "<invoice or document number, else null>",
  "issuerName": "<bank name, employer name, or issuing authority, else null>",
  "confidence": "<high | medium | low>",
  "notes": "<any important observation about document quality or data completeness>"
}
```

---

### 4.6 AI Penalty Calculator Explainer
**File:** `backend/ai/penaltyExplainer.js`

**Prompt:**
```
Calculate and explain the penalty for the following non-compliance:
[...compliance details injected...]

Return JSON:
{
  "lateDays": 12,
  "penaltyBreakdown": { "lateFee": "...", "interest": "...", "maximumLateFee": "..." },
  "totalPenalty": "₹2,940",
  "statutoryReference": "Section 47 CGST Act 2017 + Section 50 CGST Act 2017",
  "waiverAvailable": false,
  "urgencyLevel": "medium",
  "recommendedAction": "File immediately. Each additional day adds ₹100 in late fees."
}
```

---

### 4.7 Proposal Generator
**File:** `backend/ai/proposalGenerator.js`

Generate formal engagement letters with firm letterhead, scope of services, fee structure, OTP e-signature fields, and 30-day validity.

---

### 4.8 Morning Intelligence Brief
**File:** `backend/ai/morningBrief.js`

Runs at 08:45 AM IST — sends a Telegram briefing to the partner covering urgent filings, overdue invoices, new leads, expiring DSCs, and notice deadlines.

---

### 4.9 Notice Response Draft Assistant
**File:** `backend/ai/noticeResponse.js`

Draft response frameworks for GST (ASMT-10, DRC-01) and Income Tax (143(1), 148) notices with statutory references and enclosure lists.

---

### 4.10 Smart Compliance Task Auto-Generator
**File:** `backend/ai/complianceTaskGen.js`

On new client onboarding, auto-generates the full recurring compliance task schedule (GSTR-1, GSTR-3B, GSTR-9, TDS 26Q, ITR, ROC AOC-4, MGT-7) with correct due dates, document checklists, and penalty rates.

---

## PART 5: DATABASE SCHEMA (Supabase / PostgreSQL)

```sql
-- CLIENTS
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code TEXT UNIQUE NOT NULL,
  firm_name TEXT NOT NULL,
  contact_name TEXT,
  entity_type TEXT CHECK (entity_type IN ('pvt_ltd', 'llp', 'partnership', 'proprietorship', 'individual')),
  pan TEXT, gstin TEXT, whatsapp TEXT, email TEXT, state TEXT,
  gst_filing_type TEXT CHECK (gst_filing_type IN ('monthly', 'qrmp', 'nil', 'none')),
  tds_deductor BOOLEAN DEFAULT false,
  audit_required BOOLEAN DEFAULT false,
  itr_form TEXT, onboarded_date DATE, status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

-- COMPLIANCE ITEMS
CREATE TABLE compliance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  task_type TEXT NOT NULL,
  period TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'filed', 'missed')),
  filed_date DATE, ack_number TEXT, penalty_accrued NUMERIC(12,2) DEFAULT 0,
  assigned_to UUID, notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- DOCUMENT TRACKER
CREATE TABLE document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  compliance_item_id UUID REFERENCES compliance_items(id),
  document_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'verified', 'rejected')),
  received_date DATE, file_path TEXT, classified_type TEXT,
  uploaded_by TEXT DEFAULT 'firm', created_at TIMESTAMPTZ DEFAULT now()
);

-- INVOICES
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  invoice_number TEXT UNIQUE NOT NULL, invoice_date DATE NOT NULL,
  due_date DATE, service_description TEXT,
  amount NUMERIC(12,2) NOT NULL, gst_amount NUMERIC(12,2), total_amount NUMERIC(12,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'overdue', 'paid', 'cancelled')),
  paid_date DATE, payment_ref TEXT, razorpay_link TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- LEADS
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, company_name TEXT, entity_type TEXT, phone TEXT, email TEXT,
  services_required TEXT[], turnover TEXT,
  lead_score INTEGER, lead_category TEXT CHECK (lead_category IN ('hot', 'warm', 'cold')),
  stage TEXT DEFAULT 'new' CHECK (stage IN ('new', 'qualified', 'proposal_sent', 'won', 'lost')),
  source TEXT, proposal_sent_date DATE, estimated_fee TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- USERS (FIRM STAFF)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('partner', 'manager', 'article', 'client_view')),
  is_active BOOLEAN DEFAULT true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);

-- AUDIT LOGS
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID,
  old_value JSONB, new_value JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- UDIN REGISTER
CREATE TABLE udin_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  udin TEXT UNIQUE NOT NULL, ca_member_no TEXT NOT NULL,
  document_type TEXT, financial_year TEXT, generated_date DATE, report_type TEXT,
  notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- DSC REGISTER
CREATE TABLE dsc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  dsc_holder_name TEXT NOT NULL, class_type TEXT,
  valid_from DATE, valid_until DATE NOT NULL,
  token_serial TEXT, issuing_ca TEXT,
  purpose TEXT[], is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
);

-- NOTICES
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  notice_type TEXT NOT NULL, portal TEXT, notice_date DATE,
  response_deadline DATE NOT NULL, reference_number TEXT,
  tax_period TEXT, amount_in_dispute NUMERIC(12,2),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'response_filed', 'closed', 'escalated')),
  assigned_to UUID REFERENCES users(id), file_path TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## PART 6: SALES SCRIPT

### Opening Hook (30 seconds):
> "Most CA firms spend 60% of their operational time on three things: chasing clients for documents on WhatsApp, manually tracking 200+ deadlines on Excel, and reminding clients to pay overdue invoices. Our software does all three automatically — before you open your laptop in the morning."

### Demo Flow:
1. Show the morning cron dashboard — "This ran at 9 AM today and sent reminders to 12 clients automatically."
2. Show WhatsApp AI agent — Ask it a real compliance question. Show it knows the client's actual data.
3. Show the compliance calendar with penalty calculator — "If your client misses GSTR-3B today, the penalty is ₹X. Click here to send them a reminder with that exact number."
4. Show document hub with magic link — "Client gets this link on WhatsApp. They tap, upload, done. It appears in your portal instantly."
5. Show invoice recovery — "Filter overdue > 30 days. Click send reminder. Done in 10 seconds for 25 clients."

### Pricing Objection:
> "Jamku costs ₹6,500/year and lacks WhatsApp AI, document portal, and penalty calculator. We cost ₹5,999/year and include all three plus the AI assistant. What's the ROI if this recovers even one late payment per quarter?"

### "Our staff won't adopt it" Objection:
> "We offer a 3-month free trial with live onboarding. If your article assistants aren't using it in 2 weeks, we'll set it up and train them for free. Most firms are fully on-boarded in one working day."

### "We use Tally / we already have software" Objection:
> "Our software doesn't replace Tally — it works alongside it. Tally handles your books. We handle your firm operations: compliance tracking, client communication, fee collection, and document management. They're different problems."

---

## QUICK REFERENCE: TECH DECISIONS

| Decision | Recommendation | Reason |
|:---|:---|:---|
| DB Migration | Supabase (PostgreSQL) | Free tier sufficient; ACID compliance; RLS for RBAC |
| Auth | JWT + bcrypt + Supabase Auth | Production-grade; handles refresh tokens |
| Document Storage | Cloudflare R2 (already in stack) | Zero egress fees; S3-compatible |
| Payment | Razorpay (India-first) | UPI + Cards + Net Banking; webhook for auto-reconcile |
| Mobile | PWA first, React Native later | Fastest path to mobile; reuses existing JS |
| AI | Groq LLaMA 3.3 70B (conversational) + Gemini 1.5 Flash (vision) | Already integrated; keep this |
| Monitoring | Supabase built-in + free Sentry tier | Zero-cost observability |
| Hosting | Railway.app / Render.com (free tier) | Auto-deploy from GitHub; handles Node.js |

---

*Document ends. Total: 6 parts, 10 AI prompt modules, full DB schema, competitive analysis, and sales script.*

*Next step: Implement Phase 0 (auth + DB migration) before any external demos or sales conversations.*
