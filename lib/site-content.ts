/**
 * Every word and number that a CA firm would want to edit on the public site
 * lives here — no copy is buried in components.
 *
 * Review before publishing:
 *  - `testimonials` is intentionally empty; the section only renders once real
 *    client quotes are added (never ship invented ones).
 *  - `tiers` describes engagement bands without prices on purpose; add a
 *    `price` string to each tier when the firm is ready to publish numbers.
 */

/**
 * CADocs is our product; each client firm's name lives inside their own signed-in
 * workspace (Settings → Firm) and must never appear on our public site.
 */
export const PRODUCT_NAME = "CADocs";
export const COMPANY_NAME = "NexAgent";
export const SITE_TAGLINE = "Practice management for Indian CA firms";

/**
 * The sample workspace shown in the marketing screens. This is deliberately a
 * fictional firm — every visitor's own workspace is branded with *their* firm
 * name from Settings once they sign in.
 */
export const SAMPLE_FIRM = "Verma & Associates";

/**
 * Contact points shown on the public site. Fill these with NexAgent's own
 * details — they are empty by default, which hides the buttons rather than
 * showing someone else's number.
 */
export const CONTACT = {
  phone: "",
  email: "",
  whatsapp: "",
};

export const HERO = {
  eyebrow: "Built for Indian CA firms",
  title: "Run the whole practice from one desk — and never miss a filing",
  sub: "Clients, documents, GST, TDS, ITR, ROC, UDIN, notices, timesheets and fee recovery in a single workspace, with an AI copilot that answers from your own records and asks before it changes anything.",
  primaryCta: "Book a 15-minute demo",
  secondaryCta: "See the workflow",
  chips: ["GST", "TDS", "ITR", "ROC", "UDIN", "DSC", "Fee recovery"],
};

export const VALUE_STRIP = [
  { value: 15, suffix: "", label: "modules on one desk", hint: "Dashboard to UDIN register" },
  { value: 5, suffix: "", label: "statutory tracks", hint: "GST · TDS · ITR · ROC · UDIN" },
  { value: 3, suffix: "", label: "role tiers enforced", hint: "Partner · Manager · Article" },
  { value: 100, suffix: "%", label: "actions audited", hint: "Who did what, and when" },
];

export const PROBLEMS = [
  {
    title: "Deadlines live in someone's memory",
    body: "A GST return sits with the client, a TDS cycle slips, and the first signal is a notice — not a reminder.",
  },
  {
    title: "Papers move over WhatsApp",
    body: "Bank statements, purchase registers and Form 16A arrive in six chats. Nobody can say what is still missing.",
  },
  {
    title: "Fees go stale quietly",
    body: "Invoices cross 30, 60, 90 days and the awkwardness of asking grows faster than the amount.",
  },
];

export const PROMISES = [
  {
    title: "One calendar, one owner",
    body: "Every filing sits on a single statutory calendar with a responsible person and an ageing clock.",
  },
  {
    title: "Documents chase themselves",
    body: "Requests go out with the client, the office or WhatsApp, reminders follow, and chasing stops when the file lands.",
  },
  {
    title: "Money stays visible",
    body: "Billed, collected, outstanding and overdue — always current, with ageing on every invoice.",
  },
];

export type WorkflowStage = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  outcome: string;
  metric: string;
  metricLabel: string;
};

export const WORKFLOW: WorkflowStage[] = [
  {
    id: "leads",
    eyebrow: "Step 1 · Enquiry",
    title: "An enquiry lands, and it is already yours",
    body: "Website, referral, campaign or walk-in: the enquiry is captured with its source, scored Hot, Warm or Cold, and assigned to a person before the day ends.",
    outcome: "Nothing waits in an inbox overnight",
    metric: "Scored",
    metricLabel: "every enquiry, on arrival",
  },
  {
    id: "proposal",
    eyebrow: "Step 2 · Proposal",
    title: "A proposal goes out while you are on the call",
    body: "Scope, fee schedule and GST are pulled from a template, numbered, and sent on WhatsApp or email. Accepted proposals convert into a client record in one click.",
    outcome: "The firm looks organised before the first meeting",
    metric: "Numbered",
    metricLabel: "PRO-2026-018 onwards",
  },
  {
    id: "onboarding",
    eyebrow: "Step 3 · Onboarding",
    title: "The client is onboarded once, properly",
    body: "KYC, PAN, GSTIN, entity type and services are captured in one record — PAN and GSTIN encrypted at rest and hidden from read-only staff. The compliance calendar seeds itself.",
    outcome: "No detail re-typed, no folder hunting",
    metric: "Encrypted",
    metricLabel: "AES-256-GCM on PAN and GSTIN",
  },
  {
    id: "documents",
    eyebrow: "Step 4 · Documents",
    title: "The paperwork chases itself",
    body: "Each request carries an ageing clock. Reminders go out on a schedule, uploads are accepted from the client's side, and the chase stops the moment a file arrives.",
    outcome: "Your team reviews, they do not chase",
    metric: "Tracked",
    metricLabel: "every request, with age in days",
  },
  {
    id: "compliance",
    eyebrow: "Step 5 · Compliance",
    title: "Statutory deadlines never slip",
    body: "GST, TDS, ITR and ROC filings sit on one calendar, ordered by deadline, with an owner, an acknowledgement and overdue items pinned to the top.",
    outcome: "Risk is visible weeks before a notice",
    metric: "Deadline-first",
    metricLabel: "overdue work pinned to the top",
  },
  {
    id: "notices",
    eyebrow: "Step 6 · Notices",
    title: "A notice is answered inside the window",
    body: "Type, portal, amount and response deadline are logged. A reply outline is drafted from the record, the CA verifies the legal basis, and the UDIN is registered on filing.",
    outcome: "Draft in minutes, filed on time",
    metric: "Escalating",
    metricLabel: "partner alert at 3 days, then 24 hours",
  },
  {
    id: "collections",
    eyebrow: "Step 7 · Recovery",
    title: "Fees come back in, politely",
    body: "Invoices carry ageing and status. Gentle, firm and final reminders go out on WhatsApp or email in one click, and settlement closes the invoice with a UPI reference.",
    outcome: "Recovery stops being awkward",
    metric: "Ageing",
    metricLabel: "on every invoice, every day",
  },
];

export type UseCase = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  before: string;
  after: string;
  loopSteps: number;
  interval: number;
  align: "left" | "right";
};

export const USE_CASES: UseCase[] = [
  {
    id: "copilot",
    eyebrow: "AI copilot",
    title: "Ask the practice a question, get an answer from your own records",
    body: "The copilot reads the same database your team does — deadlines, documents, invoices, notices — and answers with the client names, dates and amounts that are actually there.",
    bullets: [
      "Reads through tools: deadlines, documents, invoices, client 360, revenue and utilisation",
      "Writes nothing on its own — changes are proposals you approve or dismiss",
      "Every approval is written to the audit trail with the source and model used",
    ],
    before: "Partner spends Sunday figuring out what needs attention",
    after: "One question at 9 am lists the week's real risks",
    loopSteps: 5,
    interval: 1500,
    align: "left",
  },
  {
    id: "compliance",
    eyebrow: "Compliance studio",
    title: "Every statutory deadline, one owner, no surprises",
    body: "GST returns, TDS cycles, ITR, ROC forms and UDIN-linked filings on a single calendar — filterable by client, period and status, with escalations that reach the partner.",
    bullets: [
      "GST, TDS, ITR, ROC and audit-track filings in one register",
      "Owners assigned per filing, with acknowledgements stored against the client",
      "Nav badges count what is due, overdue and awaiting documents",
    ],
    before: "Spreadsheets per client, reconciled by memory",
    after: "One calendar the whole firm trusts",
    loopSteps: 3,
    interval: 2200,
    align: "right",
  },
  {
    id: "collections",
    eyebrow: "Fee recovery",
    title: "Turn outstanding fees into collected fees, without the awkward calls",
    body: "Billed, collected, outstanding and overdue with ageing on each invoice. Reminder templates carry the invoice, the balance and the due date — sent on WhatsApp or email and logged.",
    bullets: [
      "Realisation and collection trends by partner, client and period",
      "GST-compliant invoices printable with the firm's letterhead",
      "Settlement closes the invoice and updates the client's money position",
    ],
    before: "Fees quietly crossing 60 and 90 days",
    after: "A weekly recovery list the manager actually works",
    loopSteps: 4,
    interval: 1800,
    align: "left",
  },
  {
    id: "clients",
    eyebrow: "Client 360",
    title: "One screen that answers 'where does this client stand?'",
    body: "Relationship history, money position, open filings, pending documents, proposals and every message — on one page, ready for the call the client just made.",
    bullets: [
      "Timeline of calls, documents, invoices and filings per client",
      "WhatsApp and email actions that carry the context with them",
      "Read-only article staff never see PAN, GSTIN or credentials",
    ],
    before: "Three tabs and a phone call to answer one question",
    after: "The answer is one client id away",
    loopSteps: 3,
    interval: 2000,
    align: "right",
  },
];

export const MODULES = [
  { name: "Dashboard", body: "Deadlines, money at risk and today's focus in one view." },
  { name: "AI Copilot", body: "Questions answered from your records, writes only on approval." },
  { name: "Documents", body: "Requests, ageing and uploads with a verified trail." },
  { name: "Compliance", body: "GST, TDS, ITR, ROC calendar with owners and escalations." },
  { name: "Leads", body: "Enquiries captured, scored and worked to proposal." },
  { name: "Proposals", body: "Scope, fees and GST, numbered and sent in minutes." },
  { name: "Campaigns", body: "Audiences from your client base with dispatch links." },
  { name: "Invoices", body: "GST invoicing, collections, ageing and realisation." },
  { name: "Clients", body: "Every relationship detail, one record per client." },
  { name: "UDIN Register", body: "UDINs generated per filing and searchable later." },
  { name: "DSC Tracker", body: "Token expiry dates with renewal warnings." },
  { name: "Notices", body: "Notices, deadlines, drafted replies and status." },
  { name: "Timesheets", body: "Time by client and person, feeding utilisation." },
  { name: "Reports", body: "Finance, compliance, growth and utilisation reporting." },
  { name: "Settings", body: "Firm identity, users, roles and security controls." },
];

export const ROLES = [
  {
    name: "Partner",
    body: "Full access — settings, users, deletes, and every client record. Approves AI proposals.",
    can: ["Settings & users", "Deletes", "Everything manager can do"],
  },
  {
    name: "Manager",
    body: "Runs the day: clients, compliance, documents, billing, leads and proposals.",
    can: ["Clients & compliance", "Billing & collections", "Documents & proposals"],
  },
  {
    name: "Article assistant",
    body: "Read-only on client work, plus logging their own timesheets and messages.",
    can: ["Read client work", "Own timesheets", "Internal messages"],
  },
];

export const SECURITY = [
  { title: "Passwords hashed with scrypt", body: "Memory-hard hashing with per-password salt and constant-time comparison." },
  { title: "Sessions you can revoke", body: "HMAC-signed cookies with a revision counter — signing out or changing a password ends every open session." },
  { title: "Sensitive fields encrypted", body: "PAN and GSTIN stored with AES-256-GCM, decrypted only for the roles allowed to see them." },
  { title: "Audit trail on every action", body: "Who created, changed, approved or deleted what — recorded with the entity and timestamp." },
  { title: "Cross-origin and CSRF blocked", body: "Mutating requests with a foreign origin are rejected outright, and write rate limits stop abuse." },
  { title: "Strict browser policy", body: "Content security policy, no sniffing, no framing, HSTS in production — configured at the server, not the page." },
];

export const TIERS = [
  {
    name: "Solo practitioner",
    price: "",
    body: "For a CA practising alone who wants deadlines and fees out of spreadsheets.",
    points: ["Compliance calendar", "Clients, documents, invoices", "WhatsApp and email dispatch", "AI copilot with approval flow"],
  },
  {
    name: "Growing firm",
    price: "",
    body: "For a firm with a partner, a manager and article assistants working the same list.",
    points: ["Everything in Solo", "Role-tiered access", "Leads, proposals, campaigns", "Timesheets and utilisation", "Reports and realisation"],
    featured: true,
  },
  {
    name: "Multi-partner firm",
    price: "",
    body: "For firms running several partners, branches and client books on one system.",
    points: ["Everything in Growing firm", "Ceremony-free onboarding of existing books", "Priority support and training", "Deployment options"],
  },
];

/** Real client quotes only — the section stays hidden while this is empty. */
export const TESTIMONIALS: { quote: string; name: string; role: string }[] = [];

export const FAQS = [
  {
    q: "Is our client data safe here?",
    a: "Passwords are hashed with scrypt, sessions are signed and revocable, PAN and GSTIN are encrypted at rest with AES-256-GCM, and every action is written to an audit trail. Article assistants cannot see sensitive identifiers at all.",
  },
  {
    q: "Do we have to change how our firm works?",
    a: "No. The calendar, client desk and document desk match how a CA firm already works — deadlines first, client second, paperwork behind both. Most teams start with compliance and documents, then add billing.",
  },
  {
    q: "Can we bring our existing client list in?",
    a: "Yes. Clients, compliance items, invoices and documents can be created directly, and every list exports to CSV so nothing is trapped in the system.",
  },
  {
    q: "Does the AI make changes on its own?",
    a: "Never. The copilot can read through tools and prepare proposals — a task, a reminder, a document request. Nothing is written until a partner or manager approves it, and the approval is audited.",
  },
  {
    q: "Does it work on a phone?",
    a: "Yes. The workspace is responsive, with a compact navigation bar on small screens, so a manager can chase documents or log a call from the road.",
  },
  {
    q: "How does WhatsApp fit in?",
    a: "Reminders, document requests and proposal sends open a prefilled WhatsApp message with the client's number, so the conversation stays in the channel your clients already use — and the action is logged.",
  },
  {
    q: "What about GST on our own invoices?",
    a: "Invoices apply 18% GST as CGST 9% plus SGST 9%, print on the firm's letterhead with GSTIN and address, and flow into collections and realisation reporting.",
  },
  {
    q: "How long does it take to get going?",
    a: "A single 15-minute walkthrough is usually enough to start. We set up the firm profile, the first users and the statutory calendar with you, then you add clients as you go.",
  },
];

export const DEMO_PAINS = [
  "Deadlines and filings",
  "Collecting documents",
  "Fee recovery",
  "Lead follow-up",
  "Notices and replies",
  "Team utilisation",
] as const;

export const DEMO_SIZES = ["Solo practitioner", "2–5 people", "6–20 people", "20+ people"] as const;
