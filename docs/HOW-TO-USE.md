# How to use CADocs — a one-page guide for the firm

This guide is written for the people who work in the software every day, not for
developers. If someone can use WhatsApp and a bank app, they can use this.

---

## 1. Signing in

Open the site, choose **Sign in**, and use the username and password the partner
gave you. Three roles exist:

| Role | Who | What they can do |
| --- | --- | --- |
| **Partner** | Managing partner | Everything, including firm settings and staff accounts |
| **Manager** | Operations / senior | All daily work, billing and automation — not settings or deleting clients |
| **Article** | Articles / juniors | Read everything, log their own timesheets, use the AI copilot — cannot change client or financial records |

Change your password the first time you sign in: **Settings → Security**.

---

## 2. First run (once, by the partner — five minutes)

The dashboard shows a **Get set up in 3 steps** card. Finish it and the card
disappears for good.

1. **Add your firm profile** — name, GSTIN, address. These print on every invoice.
2. **Bring in your first client** — name, PAN, GSTIN. The identifiers are
   encrypted the moment they are saved.
3. **Put automation to work** — one rule is enough to start:
   *"chase documents after 5 days"*.

Then add the rest of the client list (or import it from the CSV export format),
and add this month's filings to the compliance calendar.

---

## 3. The daily loop — the only thing to remember

Everything in the left rail is ordered the way a working day happens. Work top
to bottom. Press **»** at the top of the rail to expand it and see every module
under the move it belongs to — nothing is hidden, and the rail remembers your
choice on that computer.

### My day (`/`)

Four numbered cards, filled from live data. Each one tells you the number, what
it means, and gives you one button:

1. **Clear the statutory calendar** — overdue and due-this-week filings.
2. **Unblock the document chase** — requests open more than five days.
3. **Collect what is already earned** — invoices past their due date.
4. **Send what automation prepared** — the outbox, or a nudge to switch it on.

If a card shows zero, that move is done for the day. Move to the next one.

### Compliance (`/compliance`)

Tabs: **Filing calendar · Notices · DSC · UDIN**.

- Mark a filing done the moment you file it — the calendar is the firm's memory.
- **Generate recurring work** creates next month's GSTR/TDS/ROC tasks for every
  client in one click, and refuses to create duplicates.
- Notices have reply deadlines. A notice with no reply is a client problem you
  inherited; a notice with a reply is a service you sold.
- **DSC** is checked weekly — an expired token is a rejected filing.
- **UDIN** records the real number ICAI issued. Never invent one; the register
  rejects duplicates for the same filing.

### Documents (`/documents`)

Ask for papers against a client, then stop thinking about it. Anything older
than five days shows as a chase. Upload what the client sends, mark it
**Verified**, and the request closes. Reminders are logged, so "we asked them
three times" is a fact you can show.

### Clients (`/clients`)

Search, open a client, and you get the whole relationship on one screen: fees
due, open filings, pending documents, past proposals, what was last said.
This is the screen to open before a client phone call.

### Fees (`/invoices`)

Tabs: **Invoices · Timesheets · Reports**.

- Raise the GST invoice, then record part payments as they arrive. Ageing is
  computed, not typed.
- **Timesheets** are logged by the team and approved by a manager.
- **Reports** answers the partner's questions: what is stuck, what is realised,
  who is overloaded, which client actually pays.

### Automation (`/automation`)

Write the rule once, in English, and forget it. Two kinds:

- **Auto** — the safe, repetitive work runs by itself (queueing chasers,
  creating monthly filing tasks, recording an escalation).
- **Approval** — the rule prepares the action and waits for a human.

**Nothing is ever sent by the software.** Prepared messages wait in the
**outbox**; you open one, send it on WhatsApp or email, and mark it sent. So
"sent" always means a person sent it.

### Grow (`/leads`)

Tabs: **Leads · Proposals · Campaigns**. Enquiries are scored hot/warm/cold,
proposals are generated from the lead in seconds, and an accepted proposal
converts into a client with no retyping.

---

## 4. Where is everything?

Every screen still exists. Expand the rail (**»**) and all sixteen modules are
listed under the job they belong to; the tabs on each page are a shortcut to the
same screens. Collapsed, hover an icon to see what it holds.

| You are looking for… | Where it lives |
| --- | --- |
| Notices, DSC, UDIN | **Compliance** (tab strip, or the expanded rail) |
| Reports, Timesheets | **Fees** (tab strip, or the expanded rail) |
| Proposals, Campaigns | **Grow** (tab strip, or the expanded rail) |
| AI copilot | **Copilot** in the rail, **Ask copilot** on the dashboard, or `Ctrl+J` anywhere |

---

## 5. Asking the assistant

Press **`Ctrl+J`** (or `⌘J`) on any page and type what you want in plain
English:

- *"Who owes us the most?"*
- *"What is due this week?"*
- *"Which clients have not sent documents?"*
- *"Request bank statements from Sharma & Co"*

It answers with the numbers it actually read. When a request would change
records, it shows the change and waits for you to **approve** it. Article
accounts can ask anything but cannot approve writes.

Without an AI key the assistant still works — it answers from the firm's own
data using fixed, predictable rules. It never invents a figure.

---

## 6. Month-end checklist

1. Compliance calendar: everything filed for the month, marked done.
2. Invoices raised for the month's work; timesheets approved.
3. Outbox cleared — every prepared chaser either sent or dismissed.
4. Reports → receivables ageing: anything past 60 days gets a call, not an email.
5. Automation → run history: confirm the daily sweep ran and did what you expect.

---

## 7. Data, safety, and what to expect

- Client PAN and GSTIN are encrypted at rest; passwords are salted and hashed.
- Every sign-in, change and automation run is written to an audit trail.
- Export any register to CSV at any time (**Reports → export**), so the firm is
  never locked in.
- The AI never sends a message, never executes a write without approval, and
  never sees identifiers — only counts, amounts, dates and names.

**One caveat, stated plainly:** the public demo deployment runs on ephemeral
storage, so records entered there can be lost when the instance recycles. Use it
to evaluate the workflow. For real client records, run the app where
`CA_DATA_DIR` points at a persistent volume (see README → Deployment), and take
the CSV exports until that is in place.
