# CADocs - Client Software Requirements Specification
## Practice Management Software for Chartered Accountancy Firms

**Prepared for:** [Your Firm Name]  
**Version:** 1.0  
**Date:** October 2026

---

## 📖 Introduction

**CADocs** is a complete practice management system designed specifically for Chartered Accountancy firms in India. Think of it as your firm's digital desk — everything you need to run your practice, in one place, with no per-user pricing and no complicated onboarding.

### Core Philosophy
- **Local-first:** Your data stays on your computers. We use SQLite database installed on your system.
- **No per-seat pricing:** Pay once, use for your entire firm.
- **Partner-approved:** The AI can propose changes, but a partner or manager must approve before anything is written.
- **Built for Indian CA firms:** GST, TDS, ITR, ROC, UDIN, DSC — all India-specific statutory compliance.

> **Your firm's data is yours.** We use local-first SQLite database. Your data stays on your compute. No cloud sync. No third-party access. You control the `.data` folder on your server.

---

## 🏠 Dashboard (Homepage)

### What It Is
The first screen you see when you log in. It gives you an instant snapshot of your firm's health.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **KPIs at a glance** | See total revenue, outstanding fees, overdue items instantly |
| **Revenue chart** | Visual view of billed vs collected over time |
| **Pipeline overview** | See how many leads, proposals, and clients you have |
| **Urgent deadlines** | Quick view of what filing or task is due soonest |
| **Activity feed** | Recent actions: proposals sent, documents received, reminders logged |

### How You Use It
1. **Log in** — see your firm's status at a glance
2. **Check urgent items** — the dashboard highlights what needs attention today
3. **Click any KPI** — drills down to the detailed module (e.g., click "Outstanding Fees" → Invoices tab)
4. **Daily start** — use this as your morning briefing before calling clients

---

## 🤖 AI Copilot (Agent Page)

### What It Is
A chat interface where you can ask questions about your practice in natural language. The AI reads your actual database and answers with real client names, dates, and amounts.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Ask questions** | Type: "Which deadlines need my attention this week?" |
| **Get real answers** | AI returns: "Aurora Textiles — TDS 26Q is 2 days late. Owner: Arjun." |
| **Tool trace shown** | See which tools the AI used to find the answer |
| **Proposals, not executions** | AI can propose changes (e.g., "Create compliance task for X"), but you must approve |
| **Role-based** | Partners see all; managers see what's allowed; article staff see read-only |

### How You Use It
1. **Open the Copilot page** (`/agent`)
2. **Ask a question** — e.g., "Which clients have overdue invoices?" or "Show me pending documents for Arjun Textiles"
3. **Review the answer** — the AI lists client names, dates, amounts from your actual data
4. **Approve or dismiss** — if the AI proposes a task/reminder, you click Approve or Dismiss
5. **Keep chatting** — ask follow-up questions about any client or filing

> **Important:** The AI never writes anything on its own. It always creates a "proposal" that you must approve. This means no accidental changes, no hidden writes — everything is explicit.

---

## 📄 Documents

### What It Is
Manage client document requests, uploads, and tracking. Know what's missing, what's received, and what to chase.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Request documents** | Select a client, choose document type (bank statement, Form 16, etc.), send request via WhatsApp/email with pre-filled message |
| **Track ageing** | Each request shows how many days it's been outstanding |
| **Receive uploads** | Client uploads files through a secure link (max 8 MB, allow-listed types) |
| **Mark as received** | When client uploads, you mark it "Received" — chase stops automatically |
| **Chase history** | Log of every WhatsApp/email sent to chase the document, with timestamps |
| **File download** | Download previously uploaded files anytime |

### How You Use It
1. **Go to Documents tab**
2. **Select a client** from the list
3. **Choose document type** — e.g., "Bank statement for FY 2023-24"
4. **Send request** — a pre-filled WhatsApp/email opens with the client's number and a standard message
5. **Wait for upload** — client sends the file; you see it appear in the list
6. **Mark Received** — click the checkmark; the ageing clock resets
7. **Download if needed** — click to download any previously uploaded file

> **Real-world benefit:** No more "Did you send the bank statement?" phone calls. The system tracks it, and the client gets a pre-written message.

---

## 📅 Compliance

### What It Is
Your statutory compliance calendar — GST, TDS, ITR, ROC filings. Know what's due, who's responsible, and what's overdue.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Single calendar** | All filings (GST, TDS, ITR, ROC) in one place, ordered by deadline |
| **Owner assigned** | Each filing has a responsible person — you know who's answering for what |
| **Overdue detection** | Items turning red when past due; pinned to the top for visibility |
| **Aging clock** | How many days overdue — 2 days, 7 days, 30 days — visible on every item |
| **One-click task generation** | Generate recurring tasks for multiple clients at once (e.g., "Create GSTR-3B tasks for all active clients") |
| **Acknowledgements** | Track who acknowledged each filing |
| **Escalations** | Partner alert at 3 days before due, then 24 hours |

### How You Use It
1. **Open Compliance tab**
2. **View the calendar** — see all due dates, ordered by urgency
3. **Check ownership** — see who's responsible for each filing
4. **Sort by status** — filter to "Due this week," "Overdue," "Awaiting documents"
5. **Generate recurring tasks** — if you need GSTR-3B for all clients, one action creates them
6. **Approve proposed tasks** — the AI may propose tasks; you review and approve

> **Real-world benefit:** Never miss a filing deadline again. The calendar shows what's coming, who's responsible, and what's already late.

---

## 👥 Clients

### What It Is
A 360-degree view of every client — their relationship history, money position, open filings, pending documents, and all communication.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Client master** | Search any client and see their full profile |
| **Relationship timeline** | Calls, documents, invoices, filings — everything listed in order |
| **Money position** | How much they owe, how much you've billed, current balance |
| **Open compliance** | What filings are pending for this client |
| **Pending documents** | What documents are still awaited |
| **Invoices & proposals** | See all invoices and proposals associated with this client |
| **Logged messages** | WhatsApp/email communications with this client, with full context |
| **Edit/delete** | Partner/Manager can edit client details; guarded delete (requires confirmation) |
| **Role restrictions** | Article staff see read-only — they cannot see PAN/GSTIN or delete clients |

### How You Use It
1. **Search for a client** — type name, phone, or email
2. **View the 360° panel** — opens on the right (or in a modal)
3. **Check money position** — balance, outstanding invoices, overdue status
4. **Review pending items** — what documents, filings are waiting
5. **Log a call or message** — add a note about your recent interaction
6. **Edit if needed** — partner/manager can update client services, contact info
7. **Delete with confirmation** — guarded delete (article staff cannot delete)

> **Real-world benefit:** Before any client call, you have the full picture in 30 seconds — no need to check multiple sheets or ask your assistant.

---

## 💰 Invoices

### What It Is
GST-compliant invoices with payment recording, ageing, and overdue detection. Know who owes you, how much, and chase politely.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Create GST invoice** | Add invoice with amount, GST rate (18%: CGST 9% + SGST 9%), SAC code, place of supply |
| **Print with letterhead** | Generate printable invoice with your firm's letterhead, GSTIN, address |
| **Record partial payments** | Receive part payment (e.g., ₹5,000 on a ₹20,000 invoice); system updates balance |
| **Record full payments** | Mark invoice as paid; UPI reference number stored |
| **Payment history** | Complete log of every payment received, with date, amount, mode (UPI/cash/cheque), reference |
| **Ageing on every invoice** | How many days outstanding — 2 days, 15 days, 45 days, 90+ days |
| **Overdue detection** | Invoices turning red at 30, 60, 90+ days |
| **Settlement** | When client pays partially or fully, close the invoice and update client's money position |
| **CSV export** | Export all invoices (or selected ones) for your records or CA club filing |

### How You Use It
1. **Go to Invoices tab**
2. **Create a new invoice** — select client, amount, GST rate, add description
3. **Print or share** — generate PDF with your letterhead, or share via WhatsApp/email
4. **Record payments** — when client pays, enter amount, select UPI/cash/cheque, add reference number
5. **Watch ageing** — invoices > 30 days turn amber; > 60 days turn red
6. **Send reminders** — one-click to open pre-filled WhatsApp/email with invoice details and due date
7. **Close invoice** — when fully paid, mark as settled; client's overall balance updates

> **Real-world benefit:** Clear picture of your receivables at any moment. No more spreadsheets to track who paid and who didn't.

---

## 📊 Reports

### What It Is
Comprehensive business intelligence — ageing, realization, utilization, compliance health, client profitability, and lead conversion. Export everything to CSV.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Receivables ageing** | Bucket chart: 0-30 days, 31-60, 61-90, 90+ — how much is outstanding by age |
| **Billed vs collected** | See total you've billed vs total you've collected this period |
| **Realization rate** | % of billed amount actually collected |
| **Staff utilization** | Each staff member: billable hours vs total hours; realization per staff |
| **Client profitability** | Per-client profit: revenue minus attributable costs |
| **Compliance health** | % of filings on time vs late, by client and period |
| **Lead conversion** | How many leads became proposals → clients |
| **CSV export** | One click: export clients, invoices, payments, compliance, documents, timesheets, leads |
| **Deep links** | Export results include links back to the specific record in the app |

### How You Use It
1. **Open Reports tab**
2. **Select report type** — ageing, realization, utilization, profitability, compliance health, lead conversion
3. **View the charts** — interactive graphs showing your firm's health
4. **Filter by period** — this month, last quarter, this financial year
5. **Export to CSV** — click export; file downloads with correct headers for your Tally/Excel
6. **Use deep links** — exported data includes IDs you can click to go back to the record

> **Real-world benefit:** data-driven decisions about your firm. Know your realization rate, which clients are most profitable, which staff are busiest — all from one page.

---

## 📝 UDIN Register

### What It Is
Record UDIN (Unique Document Identification Number) for every statutory filing. Capture the real ICAI UDIN, reject duplicates, and search later.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Real UDIN capture** | Enter the UDIN generated from ICAI portal — system validates format |
| **Duplicate rejection** | Same UDIN cannot be entered twice for the same client/filing |
| **Search later** | Search UDINs by client, date, filing type |
| **Audit trail** | Who entered the UDIN, when, and for which filing |
| **Format validation** | System checks UDIN format (15 characters: 4 digits + 6 digits + 4 letters + 1 check digit) |

### How You Use It
1. **Open UDIN Register tab**
2. **Enter UDIN** for a new filing — type the 15-digit number from ICAI portal
3. **System validates** — checks format, warns if duplicate
4. **Link to client/filing** — associate with the relevant client and compliance item
5. **Search** — find previously entered UDINs by client name, date range, filing type
6. **Audit log** — see who entered it and when; useful for internal review or inspections

> **Real-world benefit:** No more fabricated UDINs. Every filing has a verifiable number, and you can search your records in seconds.

---

## 🔐 DSC Tracker

### What It Is
Track Digital Signature Certificate validity for your firm and clients. Get warnings when certificates are expiring soon.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Token validity** | Enter DSC reference; system tracks expiry date |
| **Expiring-soon alerts** | DSC turning yellow at 30 days, red at 7 days before expiry |
| **Renewal warnings** | Proactive notice — "Your DSC expires in 15 days — renew now" |
| **Firm vs client DSC** | Track both your firm's DSC and clients' DSC if you manage them |
| **Audit linkage** | Link DSC to specific filings/compliance items |

### How You Use It
1. **Open DSC Tracker tab**
2. **Enter DSC details** — firm DSC or client DSC, reference number, expiry date
3. **View status** — green (valid), yellow (expiring soon < 30 days), red (expired < 7 days)
4. **Take action** — renew DSC before it expires; all linked filings flagged for review
5. **Audit** — who added/modified DSC records, when

> **Real-world benefit:** Avoid last-minute filing rejections. Know your DSC status well before deadline, not the day before.

---

## 📢 Notices

### What It Is
Log and track notices from tax authorities (Income Tax, GST, ROC, etc.). Record the notice details, response deadline, and draft replies.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Notice log** | Enter notice number, date, authority (IT/GST/ROC), amount, due date |
| **Response deadline** | System tracks days remaining; alerts when 3 days left, then 24 hours |
| **Reply outline drafted** | AI generates a 5-part reply outline based on the notice record |
| **Status tracking** | Open → In Progress → Responded → Filed |
| **UDIN linkage** | Link the notice response to a UDIN once filed |
| **Audit trail** | Who recorded the notice, when, what status changes |

### How You Use It
1. **Open Notices tab**
2. **Enter a new notice** — type notice number, authority, amount, response deadline
3. **View ageing** — notices sorted by deadline (most urgent at top)
4. **Get reply outline** — AI drafts a reply based on the notice type and your record
5. **Track status** — move from "Open" to "In Progress" to "Responded" to "Filed"
6. **Link UDIN** — once you file the response, link the UDIN generated
7. **Audit** — complete history of notice handling for partnership review

> **Real-world benefit:** Never lose a notice notice. Response deadlines are tracked, and you always have a starting point for your reply.

---

## 📊 Timesheets

### What It Is
Record billable hours by client and person. Feed utilization and realization reports.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Enter hours** | Select person, client, date, hours worked; add description of work done |
| **Approval flow** | Partner/Manager reviews and approves timesheets before they count toward utilization |
| **Utilization calculation** | % of billable hours captured vs total hours paid; feeds the utilization report |
| **Per-client breakdown** | See hours by client per person; useful for client billing and project costing |
| **Export to CSV** | Export timesheet data for Tally integration or client billing |

### How You Use It
1. **Open Timesheets tab**
2. **Select person and client** — who worked on which client
3. **Enter hours** — date, hours, description of work (e.g., "GST filing preparation")
4. **Submit for approval** — partner/manager reviews and approves
5. **View utilization** — approved hours feed the utilization report (see % utilization per person)
6. **Export if needed** — for client invoices or project costing

> **Real-world benefit:** Accurate utilization data — know which staff are billable, which clients are costing more than they bring in.

---

## ⚙️ Settings

### What It Is
Firm profile, user management, password rotation, AI toggle, and role controls.

### Key Features

| Feature | What You Do |
|---------|-------------|
| **Firm profile** | Enter your firm name, address, GSTIN, contact details — appears on invoices and the public site |
| **User management** | Add partner, manager, article assistants; assign roles and passwords |
| **Password rotation** | Change passwords for all three roles (Partner, Manager, Article); old passwords invalidated |
| **AI toggle** | Turn AI copilot on/off — hard kill-switch; when off, AI features disabled entirely |
| **AI provider selection** | Choose which LLM provider to use (Gemini, Groq, OpenRouter, NVIDIA — first key found wins) |
| **Encryption key** | Firm's AES-256-GCM key for PAN/GSTIN; auto-generated; can be overridden |
| **Session security** | View active sessions; force logout of any user |
| **Role permissions** | Define what each role can do (partner: all; manager: operations + billing; article: read-only) |

### How You Use It
1. **Open Settings tab** (partner/manager only)
2. **Manage users** — add new team members, assign roles (Partner/Manager/Article)
3. **Change passwords** — any user can change their own password; partner can change any password
4. **Toggle AI on/off** — if you want to disable AI features entirely, turn off the switch
5. **View encryption status** — confirm PAN/GSTIN are encrypted at rest
6. **Force logout** — if a team member leaves, force their session to end
7. **Review role permissions** — ensure each person has appropriate access level

> **Real-world benefit:** Complete control over your firm's data and access. Who sees what, who can do what, and the ability to turn AI off completely if needed.

---

## 👥 Role-Based Access Control

### Three Roles Defined in the System

| Role | Who Is It For | What They Can Do |
|------|---------------|------------------|
| **Partner** | Firm partner/owner | Full access: all modules, settings, user management, delete clients, approve AI proposals |
| **Manager** | Firm manager | Operations: clients, compliance, documents, invoices, proposals, leads; billing & collections; cannot access settings/users/client deletes |
| **Article assistant** | Junior staff/assistants | Read-only: view client work, own timesheets and messages; cannot see PAN/GSTIN; cannot create/edit/delete clients |

### How It Works
- **Enforced server-side** — every request checked in `proxy.ts` before any data is sent
- **Origin check** — cross-origin mutations rejected (prevents malicious attacks from other websites)
- **Write limitations** — article staff get "Your role is read-only" message if they try to write
- **Approval flow** — even partners/managers must approve AI proposals before execution

### How You Use It
1. **Partner** — manages the firm, adds/removes users, sees everything, approves AI changes
2. **Manager** — runs the day-to-day operations, sees what they need, cannot change firm settings or delete clients
3. **Article assistant** — logs their own timesheets, sends messages, views client data they need — nothing more

> **Real-world benefit:** Your junior staff can work productively without accessing sensitive data (PAN, GSTIN, client financials). Partners retain full control.

---

## 🔒 Security & Privacy

### How Your Data Is Protected

| Control | What It Means for You |
|---------|----------------------|
| **Passwords hashed with scrypt** | Memory-hard encryption; very difficult to crack; wrong password gives 401 error |
| **Sessions you can revoke** | Log out remotely; change password and all open sessions end immediately |
| **Sensitive fields encrypted** | PAN and GSTIN stored with AES-256-GCM (military-grade encryption); decrypted only for allowed roles |
| **Audit trail on every action** | Every login, logout, password change, client edit, proposal approval — written with who, what, when |
| **Cross-origin blocked** | Requests from other websites (e.g., malicious links) are rejected outright |
| **Login brute force protection** | 10 attempts per IP+username per 15 minutes; 11th attempt → 429 error (locked out) |
| **Write rate limits** | Maximum 300 writes per user per minute — prevents abuse |
| **AI daily quota** | Default 80 tool calls per user per day — cost control and accountability |
| **Headers & CSP** | Browser security headers: CSP, no-framing, no-sniff, HSTS in production |
| **DPDP/CERT-In alignment** | Data minimisation (only needed data collected); purpose limitation (run the practice only); access/portability (CSV export); correction (client edit); erasure (guarded delete); accountability (immutable audit trail) |

### Your Privacy Rights
- **Access:** CSV export of every register (clients, invoices, payments, compliance, documents, timesheets, leads)
- **Correction:** Edit any client details yourself (partner/manager)
- **Erasure:** Guarded delete — confirm before deleting client; cascades to their compliance, documents, invoices, payments
- **Portability:** All data exports to standard CSV; no vendor lock-in

> **Real-world benefit:** Your firm's data is yours. No third-party cloud. No hidden tracking. You control the `.data` folder on your server.

---

## 📱 WhatsApp & Email Integration

### How Communication Works

| Action | What Happens |
|--------|--------------|
| **Request document** | Opens pre-filled WhatsApp web/email with client's number, standard message about the document request |
| **Send reminder** | Opens pre-filled WhatsApp/email with invoice details, due date, polite reminder text |
| **Settlement close** | After client pays, opens message to confirm closure and thank them |
| **All actions logged** | Every WhatsApp/email send is recorded in the "messages" table with timestamp, recipient, type |

### How You Use It
1. **From any module** (Invoices, Documents, Compliance, Clients) — find the "Send WhatsApp" or "Send Email" button
2. **System opens** WhatsApp Web or a mailto link pre-filled with:
   - Client's phone/email
   - Standard message template (invoice amount, due date, firm name)
   - No manual typing needed
3. **Send the message** — client receives it from your firm's number
4. **System logs** the send — you can see in the audit trail when and what was sent

> **Real-world benefit:** Your firm lives on WhatsApp — and now your tracking does too. No more "I forgot to chase that" — it's all recorded.

---

## 🚀 Workflow: From Enquiry to Realisation

### The Complete 7-Stage Journey

| Stage | What Happens | Your Action |
|-------|--------------|-------------|
| **1. Leads** | Enquiry lands (website, referral, walk-in) → scored Hot/Warm/Cold → assigned to person | Receive lead; assign to yourself or team member |
| **2. Proposal** | Send engagement proposal (scope, fee schedule, GST) on call/WhatsApp | Generate proposal from lead template; send; client accepts |
| **3. Onboarding** | Capture KYC, PAN, GSTIN, entity type, services → compliance calendar seeds itself | Enter client details; PAN/GSTIN encrypted at rest |
| **4. Documents** | Request documents via WhatsApp; client uploads; chase stops when received | Send document request; wait for upload; mark "Received" |
| **5. Compliance** | Statutory calendar with deadlines; owners assigned; overdue detection | Review calendar; ensure owners aware of deadlines |
| **6. Notices** | Income Tax/GST/ROC notices logged; reply outlines drafted; UDIN filed | Enter notice; use AI draft reply; file response with UDIN |
| **7. Collections** | Invoices issued; payments recorded; ageing tracked; reminders on WhatsApp | Issue invoice; record payments; send gentle reminders when overdue |

### Real-World Example
**Scenario:** You have a new client, "M/s Aurora Textiles"

1. **Lead** → enters system from website → assigned to you
2. **Proposal** → generate engagement proposal → send on call → client accepts → lead marked "Won"
3. **Onboarding** → enter PAN (encrypted), GSTIN (encrypted), services (GST filing, TDS, audit) → compliance calendar auto-creates due dates
4. **Documents** → request "Last 2 years bank statements" via WhatsApp → client uploads → mark "Received" → chase stops
5. **Compliance** → see GSTR-3B due 20th July, TDS 26Q due 31st July, ITR due 31st Oct — all with owners assigned
6. **Notices** → if any Income Tax notice received, enter it → AI drafts reply → file response with UDIN
7. **Collections** → issue first invoice (18% GST) → record payment when received → if 30 days overdue, send WhatsApp reminder → close invoice when fully paid

> **Your benefit:** End-to-end visibility. From first enquiry to fee collection — everything tracked, nothing forgotten.

---

## 💡 Key Benefits for Your Firm

| Benefit | How It Helps You |
|---------|------------------|
| **No per-user pricing** | Pay once for your entire firm — partner, manager, all article staff |
| **Local-first data** | Your data on your server — no cloud, no third-party access |
| **AI with approval** | AI can propose, but never writes without your explicit approval |
| **Role-based access** | Junior staff see only what they need; partners retain full control |
| **GST compliance** | Printable invoices with CGST/SGST, SAC, place of supply |
| **Audit trail** | Complete history for partnership review, inspections, DPDP/CERT-In compliance |
| **WhatsApp-native** | All chases, reminders, proposals sent where your clients already are |
| **CSV export** | Take your data anywhere — no vendor lock-in |
| **Real UDIN/DSC** | No fabricated numbers; real ICAI UDINs; DSC expiry tracking |
| **Zero hidden costs** | No per-seat fees, no add-on charges for basic features |

---

## 📞 Getting Started

### First-Time Setup (15 minutes)

1. **Download and install** CADocs on your server/computer
2. **Three role accounts created automatically** — partner, manager, article
3. **Generated passwords written to** `.data/bootstrap-credentials.txt` (read-only, mode 0600)
4. **Sign in** with partner credentials (first login forces password change)
5. **Set your firm profile** — firm name, address, GSTIN in Settings
6. **Add your first user** — manager, article assistant with assigned roles
7. **Add your first client** — enter name, contact, services
8. **Start using** — Dashboard → Compliance → see your calendar; Invoices → create first invoice

### Optional: Add AI Features
1. **Configure API key** — if you want generative AI (Gemini, Groq, OpenRouter, NVIDIA — all have free tiers)
2. **Or keep keyless** — deterministic AI works without any key; answers from your own data only
3. **Toggle on/off** — Settings → AI copilot & data privacy — hard kill-switch

---

## ❓ Frequently Asked Questions (For Your Clients)

| Question | Answer |
|----------|--------|
| **Is our client data safe?** | Yes. Passwords hashed with scrypt, sessions signed and revocable, PAN/GSTIN encrypted at rest with AES-256-GCM, every action written to audit trail. Article staff cannot see sensitive identifiers. |
| **Do we change how we work?** | No. The calendar, client desk, and document desk match how a CA firm already works — deadlines first, client second, paperwork behind both. |
| **Can we bring our existing client list?** | Yes. Clients, compliance items, invoices, and documents can be created directly; every list exports to CSV so nothing is trapped. |
| **Does the AI make changes on its own?** | Never. The copilot can read through tools and prepare proposals — a task, a reminder, a document request. Nothing is written until a partner or manager approves it, and the approval is audited. |
| **Does it work on a phone?** | Yes. The workspace is responsive, with a compact navigation bar on small screens, so a manager can chase documents or log a call from the road. |
| **How does WhatsApp fit in?** | Reminders, document requests, and proposal sends open a prefilled WhatsApp message with the client's number, so the conversation stays in the channel your clients already use — and the action is logged. |
| **What about GST on our own invoices?** | Invoices apply 18% GST as CGST 9% plus SGST 9%, print on the firm's letterhead with GSTIN and address, and flow into collections and realisation reporting. |
| **How long does it take to get going?** | A single 15-minute walkthrough is usually enough to start. We set up the firm profile, the first users, and the statutory calendar with you, then you add clients as you go. |

---

## 📥 Data Export & Portability

### What You Can Export

| Register | Export Format | What's Included |
|----------|--------------|-----------------|
| **Clients** | CSV | Client ID, name, contact, services, status, created_at |
| **Invoices** | CSV | Invoice ID, client ID, amount, GST, status, payment history, created_at |
| **Payments** | CSV | Payment ID, invoice ID, amount, mode (UPI/cash/cheque), reference, date |
| **Compliance** | CSV | Filing ID, client ID, type (GST/TDS/ITR/ROC), due date, status, owner |
| **Documents** | CSV | Document ID, client ID, type, status (Requested/Received), age in days, uploaded_at |
| **Timesheets** | CSV | Timesheet ID, person ID, client ID, hours, description, approved_at |
| **Leads** | CSV | Lead ID, source, status (New/Contacted/Proposal Sent/Won), assigned_to, created_at |

### Export Process
1. **Go to Reports tab**
2. **Select the register** you want to export
3. **Click "Export CSV"** — file downloads with correct headers
4. **Open in Excel/Tally** — all data formats ready for import

> **Your data, your choice.** No vendor lock-in. Take your data and move to another system anytime.

---

## 🆘 Support & Next Steps

### Who to Contact
- **For technical issues:** Check the audit log for errors; most issues are data-related
- **For feature questions:** Refer to this SRS or open the help tooltip on any page
- **For role/permission questions:** Settings → Role permissions

### Next Steps for Your Firm
1. **Schedule 15-minute setup walkthrough** — we'll set up your firm, users, and first clients
2. **Start with compliance** — get your statutory calendar running first
3. **Add your first 3 clients** — learn the document and invoice workflow
4. **Enable AI optionally** — keep keyless for deterministic answers, or add API key for generative features
5. **Go live** — your firm's digital desk is running

---

**CADocs — Practice Management for Indian CA Firms**  
*Local-first. Partner-approved. No per-seat pricing.*

---
*This SRS is based on CADocs v1.0 (October 2026). Features and UI may evolve with releases. For the latest version, visit the dashboard or contact support.*