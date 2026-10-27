import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  ClipboardList,
  FileText,
  HelpCircle,
  KeyRound,
  Lock,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Badge, Card, PageHeader, cn } from "@/components/ui";
import { NAV_SECTIONS } from "@/lib/nav";

export const metadata: Metadata = { title: "How to use CADocs" };

/**
 * The in-app guide. Written for the person doing the work — a partner, a
 * manager, an article assistant — in the language they use on the phone with a
 * client, not the language of the database. Deliberately a server component:
 * it reads the navigation map from lib/nav.ts, so the "where did it go" table
 * can never drift from the rail.
 */

const SETUP = [
  {
    title: "Add your firm profile",
    body: "Name, GSTIN and address. These print on every invoice you raise.",
    href: "/settings",
    cta: "Open settings",
  },
  {
    title: "Bring in your first client",
    body: "Name, PAN, GSTIN. Identifiers are encrypted the moment you save them.",
    href: "/clients",
    cta: "Add a client",
  },
  {
    title: "Switch one rule on",
    body: "One sentence is enough: “chase documents after 5 days”. The rest can wait.",
    href: "/automation",
    cta: "Set up automation",
  },
];

const DAY = [
  {
    step: "1",
    label: "Filings",
    title: "Clear the statutory calendar",
    body: "Work the overdue and due-this-week list top down, and mark each filing done as you file it. The calendar is the firm's memory.",
    href: "/compliance",
    cta: "Filing calendar",
    icon: CalendarCheck2,
  },
  {
    step: "2",
    label: "Paperwork",
    title: "Unblock the document chase",
    body: "Anything open more than five days gets one chaser per client. When the papers land, upload and mark verified — the request closes itself.",
    href: "/documents",
    cta: "Document requests",
    icon: FileText,
  },
  {
    step: "3",
    label: "Money",
    title: "Collect what is already earned",
    body: "Past-due invoices first. Record part payments as they arrive; ageing is computed, never typed.",
    href: "/invoices",
    cta: "Invoices",
    icon: CircleDollarSign,
  },
  {
    step: "4",
    label: "Automation",
    title: "Send what was prepared",
    body: "Open the outbox, send each prepared chaser, mark it sent. Nothing leaves this software on its own.",
    href: "/automation",
    cta: "Outbox",
    icon: Zap,
  },
];

const ROLES = [
  { role: "Partner", who: "Managing partner", can: "Everything — firm settings, staff accounts, deleting clients." },
  { role: "Manager", who: "Operations / senior", can: "All daily work, billing and automation. Not settings, accounts or client deletion." },
  { role: "Article", who: "Articles / juniors", can: "Reads everything, logs their own timesheets, asks the copilot. Cannot change records." },
];

const MONTH_END = [
  "Compliance calendar: every filing for the month marked done.",
  "Invoices raised, timesheets approved, payments recorded.",
  "Outbox cleared — every prepared message sent or dismissed.",
  "Reports → ageing: anything past 60 days gets a phone call, not an email.",
  "Automation → run history: confirm the sweep ran and did what you expect.",
];

const SAFETY = [
  "PAN and GSTIN are encrypted at rest; passwords are salted and hashed.",
  "Every sign-in, change and automation run is written to the audit trail.",
  "Any register exports to CSV, so the firm is never locked in.",
  "The assistant never sends, never writes without approval, and never sees identifiers.",
];

function Section({
  icon: Icon,
  title,
  blurb,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sage text-green">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">{title}</h2>
          <p className="text-[11px] leading-relaxed text-muted">{blurb}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export default function HelpPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Guide"
        title="How to use this software"
        description="One page, plain language. If you can use WhatsApp, you can use this — and if something still isn't obvious, that is a bug in the software, not in you."
      >
        <Link
          href="/"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-green px-4 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(59,82,68,0.6)] transition hover:bg-green-dark"
        >
          Back to my day <ArrowRight className="h-4 w-4" />
        </Link>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          icon={KeyRound}
          title="1. Set up once — five minutes"
          blurb="The dashboard nudges you until these are done, then stops."
        >
          <ol className="space-y-2">
            {SETUP.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3 rounded-2xl bg-subtle/60 p-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-extrabold text-ink">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-ink">{step.title}</p>
                  <p className="text-[11px] leading-relaxed text-muted">{step.body}</p>
                  <Link href={step.href} className="mt-1 inline-flex text-[11px] font-bold text-green hover:underline">
                    {step.cta} →
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          icon={Users}
          title="2. Who signs in as what"
          blurb="Your role decides what you can change. Reads are open to everyone on the team."
        >
          <div className="space-y-2">
            {ROLES.map((row) => (
              <div key={row.role} className="rounded-2xl border border-black/5 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.role === "Partner" ? "green" : row.role === "Manager" ? "amber" : "neutral"}>{row.role}</Badge>
                  <span className="text-[11px] font-semibold text-muted">{row.who}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{row.can}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section
        icon={ClipboardList}
        title="3. The daily loop — the only thing to remember"
        blurb="The rail is ordered the way a working day happens. Work top to bottom; when a move shows zero, it is done."
      >
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {DAY.map((move) => (
            <Link
              key={move.title}
              href={move.href}
              className="group flex h-full flex-col rounded-2xl border border-black/5 bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-26px_rgba(25,32,28,0.55)]"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sage text-[10px] font-extrabold text-green">
                  {move.step}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{move.label}</span>
                <move.icon className="ml-auto h-3.5 w-3.5 text-muted" strokeWidth={2} />
              </div>
              <p className="mt-2 text-xs font-extrabold text-ink">{move.title}</p>
              <p className="mt-1 flex-1 text-[11px] leading-relaxed text-muted">{move.body}</p>
              <span className="mt-2.5 text-[11px] font-bold text-green">{move.cta} →</span>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          icon={HelpCircle}
          title="4. Every screen, and where it lives"
          blurb="Nothing was removed. The rail groups screens by the job they do; press » at the top of the rail to list all sixteen modules at once."
        >
          <div className="divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/5">
            {NAV_SECTIONS.filter((section) => section.tabs.length > 0).map((section) => (
              <div key={section.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <span className="w-28 shrink-0 text-[11px] font-extrabold text-ink">{section.label}</span>
                <span className="flex flex-1 flex-wrap gap-1.5">
                  {section.tabs.map((tab) => (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      title={tab.hint}
                      className="rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-sage hover:text-green"
                    >
                      {tab.label}
                    </Link>
                  ))}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className="w-28 shrink-0 text-[11px] font-extrabold text-ink">Copilot</span>
              <span className="flex flex-1 flex-wrap gap-1.5">
                <Link
                  href="/agent"
                  className="rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-sage hover:text-green"
                >
                  Copilot
                </Link>
                <span className="text-[11px] leading-relaxed text-muted">
                  Any page: <kbd className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-ink">Ctrl</kbd> +{" "}
                  <kbd className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-ink">J</kbd>
                </span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className="w-28 shrink-0 text-[11px] font-extrabold text-ink">Single screens</span>
              <span className="flex flex-1 flex-wrap gap-1.5">
                {[
                  { label: "My day", href: "/" },
                  { label: "Documents", href: "/documents" },
                  { label: "Clients", href: "/clients" },
                  { label: "Automation", href: "/automation" },
                  { label: "Settings", href: "/settings" },
                ].map((screen) => (
                  <Link
                    key={screen.href}
                    href={screen.href}
                    className="rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-sage hover:text-green"
                  >
                    {screen.label}
                  </Link>
                ))}
              </span>
            </div>
          </div>
        </Section>

        <Section
          icon={Sparkles}
          title="5. Asking instead of clicking"
          blurb="Type what you want in plain English and the assistant answers from the firm's own numbers."
        >
          <div className="space-y-1.5">
            {[
              "Who owes us the most?",
              "What is due this week?",
              "Which clients have not sent their documents?",
              "Request bank statements from Sharma & Co",
            ].map((q) => (
              <p key={q} className="rounded-xl bg-subtle/70 px-3 py-2 text-[11px] font-semibold text-ink">
                “{q}”
              </p>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            When a request would change a record, it shows you the change and waits for your approval. Article accounts can ask anything,
            but cannot approve. Without an AI key it still answers — from your data, by fixed rules, and it never invents a figure.
          </p>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={CheckCircle2} title="6. Month-end checklist" blurb="Ten minutes, once a month, and nothing slips.">
          <ul className="space-y-2">
            {MONTH_END.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                <Circle className="mt-0.5 h-3 w-3 shrink-0 text-green" strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={Lock} title="7. Your data" blurb="What the software does with client information, stated plainly.">
          <ul className="space-y-2">
            {SAFETY.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[#3E8A52]" strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-xl bg-gold-soft/60 px-3 py-2 text-[11px] leading-relaxed text-[#6B5325]">
            The public demo deployment keeps data on temporary storage, so treat it as a trial. For live client records, run the app
            against a persistent data directory and keep the CSV exports until that is in place.
          </p>
        </Section>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-extrabold tracking-tight text-ink">Still stuck?</p>
          <p className="text-[11px] text-muted">The quickest path is usually the guided day on the dashboard — it points at whatever is most urgent.</p>
        </div>
        <Link
          href="/"
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white",
            "transition hover:bg-ink/90",
          )}
        >
          Open my day <ArrowRight className="h-4 w-4" />
        </Link>
      </Card>
    </div>
  );
}
