import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  Clock3,
  FileWarning,
  ListChecks,
  ReceiptIndianRupee,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { countQueuedMessages, getDashboard, getSettings, listAutomationRules } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildWorkflow } from "@/lib/workflow";
import { getService, stageInfo } from "@/lib/services";
import { automationBacklog } from "@/lib/automation";
import { buildInsights, deterministicBrief } from "@/lib/insights";
import { AiBriefLine } from "@/components/ai-widgets";
import { Badge, Card, PageHeader, Progress, Stat, StatusPill, cn } from "@/components/ui";
import { FeeGauge, RevenueChart } from "@/components/charts";
import { compactInr, dayDiff, firmHour, firmLongDate, inr, prettyDate, relativeDeadline, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  const workflow = buildWorkflow(user);
  const myWork = workflow.myWork.slice(0, 5);
  const data = getDashboard();
  const settings = getSettings();
  const k = data.kpis;
  // Server components render in the host's timezone (UTC on Vercel); the firm
  // works in IST, so the greeting and date are formatted there instead.
  const hour = firmHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = firmLongDate();
  const outstanding = k.totalBilled - k.totalCollected;
  const insights = buildInsights();
  const briefText = deterministicBrief();

  // ── The working day, in the order a firm actually works it ──────────────────
  const backlog = automationBacklog();
  const queuedOutbox = countQueuedMessages();
  const activeRules = listAutomationRules().filter((rule) => rule.enabled).length;

  const todaySteps = [
    {
      step: "Filings",
      count: `${k.overdueCompliance} overdue`,
      title: "Clear the statutory calendar",
      body: `${k.complianceDueThisWeek} filing(s) due this week. Start at the top of the list — statutory delay is the only mistake clients don't forgive.`,
      href: "/compliance",
      cta: "Open the calendar",
      tone: k.overdueCompliance > 0 ? "border-red-900/10 bg-[#FBEAE7]/50" : "border-black/5 bg-white",
    },
    {
      step: "Paperwork",
      count: `${k.pendingDocuments} waiting`,
      title: "Unblock the document chase",
      body: `${backlog.documents} request(s) have been open 5+ days. Send one chaser per client and the block clears itself.`,
      href: "/documents",
      cta: "Chase documents",
      tone: "border-gold/20 bg-gold-soft/40",
    },
    {
      step: "Money",
      count: compactInr(k.overdueFees),
      title: "Collect what is already earned",
      body: `${data.overdueInvoices.length} invoice(s) past due. A firm reminder this week is worth more than a new filing.`,
      href: "/invoices",
      cta: "Recover fees",
      tone: k.overdueFees > 0 ? "border-red-900/10 bg-[#FBEAE7]/50" : "border-green/15 bg-sage/50",
    },
    {
      step: "Automation",
      count: queuedOutbox > 0 ? `${queuedOutbox} prepared` : `${activeRules} rule${activeRules === 1 ? "" : "s"}`,
      title: queuedOutbox > 0 ? "Send what automation prepared" : "Switch automation on",
      body:
        queuedOutbox > 0
          ? "Chasers and reminders are drafted and waiting. Open the outbox, send them, mark them sent."
          : activeRules > 0
            ? "Your rules run on their own schedule. Check the last sweep and the run history."
            : "Automate the chasing, dunning and monthly filings once — then it runs without you.",
      href: "/automation",
      cta: queuedOutbox > 0 ? "Open the outbox" : "Set up automation",
      tone: "border-green/15 bg-sage/50",
    },
  ];

  const setupSteps = [
    {
      done: Boolean(settings.firm_name && settings.firm_gstin),
      label: "Add your firm profile",
      hint: "Name, GSTIN and address — they print on every invoice.",
      href: "/settings",
    },
    {
      done: k.activeClients > 0,
      label: "Bring in your first client",
      hint: "PAN and GSTIN are encrypted the moment they are saved.",
      href: "/clients",
    },
    {
      done: activeRules > 0,
      label: "Put automation to work",
      hint: "One command in plain English — \u201cchase documents after 5 days\u201d.",
      href: "/automation",
    },
  ];
  const setupDone = setupSteps.filter((s) => s.done).length;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={dateLabel}
        title={`${greeting}, ${user?.name ?? "there"}`}
        description={`${settings.firm_name ?? "Your firm"} has ${k.complianceDueThisWeek} filings due this week, ${workflow.totals.docsPending} documents pending and ${inr(k.overdueFees)} stuck in overdue fees.`}
      >
        <Link
          href="/agent"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-ink shadow-sm ring-1 ring-black/10 transition hover:bg-subtle"
        >
          <Sparkles className="h-4 w-4 text-gold" /> Ask copilot
        </Link>
        <Link
          href="/clients"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-green px-4 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(59,82,68,0.6)] transition hover:bg-green-dark"
        >
          <Users className="h-4 w-4" /> Onboard client
        </Link>
      </PageHeader>

      {/* ── My desk: the role-specific queue, before the firm-wide picture ──── */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
              <ListChecks className="h-3.5 w-3.5" /> My desk
            </p>
            <p className="mt-0.5 text-sm font-extrabold text-ink">
              {myWork.length ? `${workflow.myWork.length} filing${workflow.myWork.length === 1 ? "" : "s"} waiting on you` : "Your queue is clear"}
            </p>
            <p className="text-[11px] text-muted">
              {user?.role === "partner" ? "Sign-offs and final audits land here." : user?.role === "manager" ? "Returns to review and portal filings land here." : "Documents and preparation work assigned to you."}
            </p>
          </div>
          <Link href="/workflow" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle">
            Open workflow <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {myWork.length === 0 ? (
          <p className="rounded-2xl bg-subtle px-3 py-3 text-[11px] text-muted">Nothing is assigned to you right now. New work appears the moment a stage is handed over.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {myWork.map((task) => (
              <Link
                key={task.compliance_id}
                href="/workflow"
                className="rounded-2xl border border-black/5 bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-18px_rgba(25,32,28,0.45)]"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <p className="min-w-0 truncate text-[11px] font-bold text-ink">{task.client_name}</p>
                  <Badge tone={task.stage === "signoff" ? "amber" : task.stage === "documents" ? "red" : "blue"}>{stageInfo(task.stage).short}</Badge>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted">{getService(task.service_code).short} · {task.period}</p>
                <p className={`mt-1.5 text-[10px] font-semibold ${task.due_date < todayISO() ? "text-[#A33B2E]" : "text-muted"}`}>{relativeDeadline(task.due_date)}</p>
                <p className="mt-0.5 text-[9px] text-muted">{task.docs_pending ? `${task.docs_pending} document(s) pending` : "Documents clear"}</p>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* ── First run: setup, hidden the moment it is complete ──────────────── */}
      {setupDone < setupSteps.length ? (
        <Card className="border-gold/25 bg-gold-soft/30 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Get set up in 3 steps</h2>
              <p className="text-[11px] text-muted">This card disappears once all three are done.</p>
            </div>
            <Badge tone="amber">
              {setupDone}/{setupSteps.length} done
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {setupSteps.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className="flex items-start gap-2.5 rounded-2xl bg-white/70 p-3 transition hover:bg-white"
              >
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3E8A52]" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                )}
                <span className="min-w-0">
                  <span className={cn("block text-xs font-bold", step.done ? "text-muted line-through" : "text-ink")}>{step.label}</span>
                  <span className="block text-[11px] leading-relaxed text-muted">{step.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ── Today: the four moves that clear a working day ───────────────────── */}
      <section aria-label="Today's workflow">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">Your day, in four moves</h2>
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-muted">Work top to bottom — each move clears the next.</p>
            <Link href="/help" className="text-[11px] font-bold text-green hover:underline">
              How to use this →
            </Link>
          </div>
        </div>
        <div data-today-moves className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {todaySteps.map((card, index) => (
            <Link
              key={card.title}
              href={card.href}
              className={cn(
                "group flex h-full flex-col rounded-3xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(25,32,28,0.55)]",
                card.tone,
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-[11px] font-extrabold text-ink">
                  {index + 1}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{card.step}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />
              </div>
              <p className="mt-2.5 text-xl font-extrabold leading-none tracking-tight text-ink">{card.count}</p>
              <p className="mt-1.5 text-xs font-extrabold text-ink">{card.title}</p>
              <p className="mt-1 flex-1 text-[11px] leading-relaxed text-muted">{card.body}</p>
              <span className="mt-3 text-[11px] font-bold text-green">{card.cta} →</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active clients" value={k.activeClients} hint={`${k.pendingDocuments} client documents pending`} icon={<Users className="h-4 w-4" />} />
        <Stat
          label="Due this week"
          value={k.complianceDueThisWeek}
          hint={`${k.overdueCompliance} overdue · ${k.pendingDocuments} docs pending`}
          icon={<CalendarCheck2 className="h-4 w-4" />}
          tone="gold"
        />
        <Stat
          label="Overdue fees"
          value={compactInr(k.overdueFees)}
          hint={`${data.overdueInvoices.length} ${data.overdueInvoices.length === 1 ? "invoice needs" : "invoices need"} chasing`}
          icon={<ReceiptIndianRupee className="h-4 w-4" />}
          tone="rose"
        />
        <Stat
          label="Fee recovery"
          value={`${k.collectionRate}%`}
          hint={`${compactInr(k.totalCollected)} of ${compactInr(k.totalBilled)} collected`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Fee recovery</h2>
              <p className="text-[11px] text-muted">Billing vs collections for the current cycle</p>
            </div>
            <Badge tone={k.collectionRate >= 70 ? "green" : "amber"}>{k.collectionRate >= 70 ? "On track" : "Needs attention"}</Badge>
          </div>
          <div className="grid items-center gap-4 sm:grid-cols-[240px_1fr]">
            <FeeGauge rate={k.collectionRate} collected={k.totalCollected} billed={k.totalBilled} />
            <div className="space-y-3">
              <div className="rounded-2xl bg-subtle p-4">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted">Outstanding</span>
                  <span className="text-ink">{inr(outstanding)}</span>
                </div>
                <div className="mt-2">
                  <Progress value={k.collectionRate} tone={k.collectionRate >= 70 ? "green" : "amber"} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-black/5 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">To collect</p>
                  <p className="mt-1 text-base font-extrabold text-ink">{compactInr(outstanding)}</p>
                </div>
                <div className="rounded-2xl border border-red-900/10 bg-[#FBEAE7]/60 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#A33B2E]">Overdue</p>
                  <p className="mt-1 text-base font-extrabold text-[#A33B2E]">{compactInr(k.overdueFees)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <Clock3 className="h-3.5 w-3.5" />
                {k.pendingTimesheets} timesheets awaiting approval
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between overflow-hidden bg-green p-5 text-white">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
              <Sparkles className="h-3.5 w-3.5" /> Morning brief
            </div>
            <h2 className="text-lg font-extrabold leading-snug">
              {k.overdueCompliance > 0 ? `${k.overdueCompliance} filings need attention today` : "All filings are on track today"}
            </h2>
            <ul className="mt-4 space-y-2.5 text-xs leading-relaxed text-white/75">
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F3C77A]" />
                {data.urgentCompliance[0]
                  ? `${data.urgentCompliance[0].client_name} — ${data.urgentCompliance[0].compliance_type}, ${relativeDeadline(data.urgentCompliance[0].due_date)}`
                  : "No open compliance tasks."}
              </li>
              <li className="flex gap-2">
                <ReceiptIndianRupee className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F3C77A]" />
                {k.overdueFees > 0
                  ? `${inr(k.overdueFees)} overdue across ${data.overdueInvoices.length} ${data.overdueInvoices.length === 1 ? "invoice" : "invoices"} — start with ${data.overdueInvoices[0]?.client_name ?? "the oldest"}.`
                  : "No overdue fees — collections are healthy."}
              </li>
              <li className="flex gap-2">
                <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F3C77A]" />
                {k.pendingDocuments} client documents pending.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F3C77A]" />
                {k.activeNotices} active notices with {data.overdueInvoices.length > 0 ? "deadlines this month." : "no immediate deadline."}
              </li>
            </ul>
          </div>
          <Link
            href="/agent"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-xs font-bold text-white ring-1 ring-white/15 transition hover:bg-white/15"
          >
            Open practice copilot <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Upcoming deadlines</h2>
              <p className="text-[11px] text-muted">Sorted by urgency across all clients</p>
            </div>
            <Link href="/compliance" className="flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-black/5">
            {data.urgentCompliance.slice(0, 5).map((c) => {
              const overdue = dayDiff(c.due_date) < 0;
              return (
                <div key={c.compliance_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${overdue ? "bg-[#FBEAE7] text-[#A33B2E]" : "bg-sage text-sage-ink"}`}>
                    {overdue ? <AlertTriangle className="h-4 w-4" /> : <CalendarCheck2 className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{c.client_name}</p>
                    <p className="truncate text-[11px] text-muted">
                      {c.compliance_type} · {relativeDeadline(c.due_date)}
                    </p>
                  </div>
                  <StatusPill status={c.status} />
                </div>
              );
            })}
            {data.urgentCompliance.length === 0 ? <p className="py-8 text-center text-xs text-muted">🎉 All filings are up to date.</p> : null}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Overdue invoices</h2>
              <p className="text-[11px] text-muted">Oldest dues first — chase these today</p>
            </div>
            <Link href="/invoices" className="flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
              Recover fees <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-black/5">
            {data.overdueInvoices.map((inv) => (
              <div key={inv.invoice_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FBEAE7] text-[#A33B2E]">
                  <ReceiptIndianRupee className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{inv.client_name}</p>
                  <p className="truncate text-[11px] text-muted">
                    {inv.invoice_id} · {inv.daysOverdue} days overdue
                  </p>
                </div>
                <span className="text-sm font-extrabold text-ink">{compactInr(inv.total_amount)}</span>
              </div>
            ))}
            {data.overdueInvoices.length === 0 ? <p className="py-8 text-center text-xs text-muted">No overdue invoices — collection is clean.</p> : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Revenue trend</h2>
              <p className="text-[11px] text-muted">Billed vs collected over the last six months</p>
            </div>
            <Badge tone="sage">Last 6 months</Badge>
          </div>
          <RevenueChart data={data.revenueByMonth} />
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-ink">
              <Sparkles className="h-4 w-4 text-gold" /> AI analyst
            </h2>
            <p className="text-[11px] text-muted">Computed from live rows — no numbers are ever generated</p>
          </div>
          <Badge tone="sage">{insights.length} insight{insights.length === 1 ? "" : "s"}</Badge>
        </div>
        <AiBriefLine initial={briefText} />
        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          {insights.map((insight) => {
            const tones = {
              risk: { box: "bg-[#FBEAE7]/70 border-red-900/10", text: "text-[#A33B2E]", icon: <AlertTriangle className="h-4 w-4" /> },
              warn: { box: "bg-gold-soft/50 border-gold/20", text: "text-gold", icon: <Clock3 className="h-4 w-4" /> },
              info: { box: "bg-[#E7EDF4]/70 border-[#3B5876]/15", text: "text-[#3B5876]", icon: <Sparkles className="h-4 w-4" /> },
              good: { box: "bg-sage/70 border-green/15", text: "text-sage-ink", icon: <CheckCircle2 className="h-4 w-4" /> },
            }[insight.tone];
            return (
              <div key={insight.id} className={`flex items-start gap-3 rounded-2xl border p-4 ${tones.box}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 ${tones.text}`}>{tones.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-ink">{insight.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{insight.body}</p>
                  {insight.action_href ? (
                    <Link href={insight.action_href} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
                      {insight.action_label} <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
          {insights.length === 0 ? (
            <p className="col-span-full rounded-2xl bg-sage/60 px-4 py-6 text-center text-xs text-sage-ink">
              Nothing needs attention right now — ageing, compliance and certificates are all within limits.
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <div>
            <h2 className="text-sm font-extrabold tracking-tight text-ink">Recent activity</h2>
            <p className="text-[11px] text-muted">Audit trail across the practice</p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">SA-230 compliant</span>
        </div>
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Actor</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Activity</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Module</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-muted">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentActivity.map((a) => (
                <tr key={a.id} className="border-t border-black/5">
                  <td className="px-3 py-3 text-xs font-semibold text-ink">{a.actor}</td>
                  <td className="px-3 py-3 text-xs text-muted">{a.detail}</td>
                  <td className="px-3 py-3">
                    <Badge tone="neutral">{a.entity_type}</Badge>
                  </td>
                  <td className="px-3 py-3 text-right text-[11px] text-muted">{timeAgo(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="pb-2 text-center text-[10px] text-muted">
        {settings.firm_name} · {settings.firm_tagline} · Last refreshed {prettyDate(todayISO())}
      </p>
    </div>
  );
}
