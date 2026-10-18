import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  FileWarning,
  ReceiptIndianRupee,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { getDashboard, getSettings } from "@/lib/db";
import { buildInsights, deterministicBrief } from "@/lib/insights";
import { AiBriefLine } from "@/components/ai-widgets";
import { Badge, Card, PageHeader, Progress, Stat, StatusPill } from "@/components/ui";
import { FeeGauge, PipelineBars, RevenueChart } from "@/components/charts";
import { compactInr, dayDiff, inr, prettyDate, relativeDeadline } from "@/lib/format";

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

export default function DashboardPage() {
  const data = getDashboard();
  const settings = getSettings();
  const k = data.kpis;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const outstanding = k.totalBilled - k.totalCollected;
  const insights = buildInsights();
  const briefText = deterministicBrief();

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={dateLabel}
        title={`${greeting}, Managing Partner`}
        description={`${settings.firm_name ?? "Your firm"} has ${k.complianceDueThisWeek} filings due this week and ${inr(k.overdueFees)} stuck in overdue fees.`}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active clients" value={k.activeClients} hint={`${k.openLeads} open leads in pipeline`} icon={<Users className="h-4 w-4" />} />
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
                {k.pendingDocuments} client documents pending; {k.hotLeads} hot leads waiting on a proposal.
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
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="text-sm font-extrabold tracking-tight text-ink">Lead pipeline</h2>
            <p className="text-[11px] text-muted">{k.openLeads} open opportunities</p>
          </div>
          <PipelineBars data={data.pipeline} />
          <Link href="/leads" className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
            Work the pipeline <ArrowUpRight className="h-3 w-3" />
          </Link>
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
        {settings.firm_name} · {settings.firm_tagline} · Last refreshed {prettyDate(new Date().toISOString())}
      </p>
    </div>
  );
}
