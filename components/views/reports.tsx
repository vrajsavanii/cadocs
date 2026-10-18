import Link from "next/link";
import { ArrowUpRight, CalendarCheck2, Clock3, Download, ReceiptIndianRupee, Target, TrendingUp, Users, Wallet } from "lucide-react";
import type { ReportData } from "@/lib/types";
import { Badge, Card, PageHeader, TableShell, Td, Th } from "@/components/ui";
import { RevenueChart } from "@/components/charts";
import { compactInr, inr } from "@/lib/format";

const EXPORTS = [
  { type: "invoices", label: "Invoices" },
  { type: "payments", label: "Payments" },
  { type: "compliance", label: "Compliance" },
  { type: "timesheets", label: "Timesheets" },
  { type: "clients", label: "Clients" },
  { type: "leads", label: "Leads" },
] as const;

export function ReportsView({ data }: { data: ReportData }) {
  const ageingTotal = data.ageing.reduce((s, b) => s + b.amount, 0);
  const maxAgeing = Math.max(1, ...data.ageing.map((b) => b.amount));
  const billableHours = data.utilization.reduce((s, u) => s + u.billable, 0);
  const totalHours = data.utilization.reduce((s, u) => s + u.hours, 0);
  const billableShare = totalHours ? Math.round((billableHours / totalHours) * 100) : 0;
  const filedShare = data.compliance.total ? Math.round((data.compliance.filed / data.compliance.total) * 100) : 0;
  const onTimeShare = data.compliance.filed ? Math.round((data.compliance.onTime / data.compliance.filed) * 100) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Practice intelligence"
        title="Reports & performance"
        description="Receivables ageing, realization, staff utilization, compliance health, client profitability and conversion — from live practice data."
      >
        {EXPORTS.slice(0, 3).map((e) => (
          <a
            key={e.type}
            href={`/api/export?type=${e.type}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
          >
            <Download className="h-3.5 w-3.5" /> {e.label}
          </a>
        ))}
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-6">
        <Kpi label="Billed" value={compactInr(data.finance.billed)} icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Kpi label="Collected" value={compactInr(data.finance.collected)} icon={<Wallet className="h-4 w-4" />} tone="green" />
        <Kpi label="Outstanding" value={compactInr(data.finance.outstanding)} icon={<TrendingUp className="h-4 w-4" />} tone="gold" />
        <Kpi label="Overdue" value={compactInr(data.finance.overdue)} icon={<Clock3 className="h-4 w-4" />} tone="rose" />
        <Kpi label="Realization" value={`${data.finance.realization}%`} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <Kpi label="Avg days to pay" value={`${data.finance.avgDaysToPay}`} icon={<Clock3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Receivables ageing</h2>
              <p className="text-[11px] text-muted">Balance by days past due — chase the 90+ bucket first</p>
            </div>
            <Badge tone={data.finance.overdue > 0 ? "red" : "green"}>{inr(ageingTotal)} open</Badge>
          </div>
          <div className="space-y-3">
            {data.ageing.map((bucket) => (
              <div key={bucket.bucket}>
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                  <span className="text-muted">{bucket.bucket} <span className="text-[10px] text-muted/70">({bucket.count})</span></span>
                  <span className="text-ink">{inr(bucket.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/[0.05]">
                  <div
                    className={`h-full rounded-full ${bucket.bucket === "90+ days" ? "bg-[#B4433A]" : bucket.bucket === "61–90 days" ? "bg-[#C98A3E]" : "bg-green/75"}`}
                    style={{ width: `${(bucket.amount / maxAgeing) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Link href="/invoices" className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
            Open invoices <ArrowUpRight className="h-3 w-3" />
          </Link>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Billed vs collected</h2>
              <p className="text-[11px] text-muted">Last six months, from invoices and payment receipts</p>
            </div>
            <Badge tone="sage">6 months</Badge>
          </div>
          <RevenueChart data={data.monthly} />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-start justify-between gap-2 px-5 pb-3 pt-5">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink">
                <Users className="h-4 w-4" /> Staff utilization
              </h2>
              <p className="text-[11px] text-muted">{billableShare}% of {totalHours}h logged is billable · approved hours only count toward WIP</p>
            </div>
            <a href="/api/export?type=timesheets" className="text-[11px] font-bold text-green hover:underline">CSV</a>
          </div>
          {data.utilization.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted">No timesheets logged yet.</p>
          ) : (
            <TableShell>
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="bg-subtle/60">
                    <Th>Staff</Th>
                    <Th className="text-right">Hours</Th>
                    <Th className="text-right">Billable</Th>
                    <Th className="text-right">Approved</Th>
                    <Th className="text-right">Clients</Th>
                    <Th className="text-right">Billable %</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.utilization.map((u) => (
                    <tr key={u.user} className="border-t border-black/5">
                      <Td><span className="text-xs font-semibold text-ink">{u.user}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{u.hours}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{u.billable}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{u.approved}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{u.clients}</span></Td>
                      <Td className="text-right">
                        <span className="text-xs font-bold text-ink">{u.hours ? Math.round((u.billable / u.hours) * 100) : 0}%</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink">
                <CalendarCheck2 className="h-4 w-4" /> Compliance health
              </h2>
              <p className="text-[11px] text-muted">Filed vs open, on-time rate and tasks due in the next 7 days</p>
            </div>
            <a href="/api/export?type=compliance" className="text-[11px] font-bold text-green hover:underline">CSV</a>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Filed" value={`${data.compliance.filed}/${data.compliance.total}`} hint={`${filedShare}% complete`} />
            <Mini label="On time" value={`${onTimeShare}%`} hint={`${data.compliance.onTime} of ${data.compliance.filed} filed`} />
            <Mini label="Due 7 days" value={`${data.compliance.dueThisWeek}`} hint="Open tasks" />
            <Mini label="Overdue" value={`${data.compliance.overdue}`} hint="Needs action" tone="rose" />
          </div>
          <div className="mt-4 space-y-2">
            {data.compliance.byType.length === 0 ? <p className="py-4 text-center text-xs text-muted">No compliance tasks yet.</p> : null}
            {data.compliance.byType.map((row) => {
              const total = row.open + row.filed;
              return (
                <div key={row.type} className="flex items-center gap-3">
                  <span className="w-1/2 truncate text-[11px] text-muted">{row.type}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                    <div className="h-full rounded-full bg-green/70" style={{ width: `${total ? (row.filed / total) * 100 : 0}%` }} />
                  </div>
                  <span className="w-10 text-right text-[10px] font-semibold text-muted">{row.filed}/{total}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="flex items-start justify-between gap-2 px-5 pb-3 pt-5">
            <div>
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Client profitability</h2>
              <p className="text-[11px] text-muted">Billed, collected and outstanding by client; WIP hours are approved billable time</p>
            </div>
            <a href="/api/export?type=invoices" className="text-[11px] font-bold text-green hover:underline">CSV</a>
          </div>
          {data.clients.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted">No billing data yet.</p>
          ) : (
            <TableShell>
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="bg-subtle/60">
                    <Th>Client</Th>
                    <Th className="text-right">Billed</Th>
                    <Th className="text-right">Collected</Th>
                    <Th className="text-right">Outstanding</Th>
                    <Th className="text-right">WIP hours</Th>
                    <Th className="text-right">Realization</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.client} className="border-t border-black/5">
                      <Td><span className="text-xs font-semibold text-ink">{c.client}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{compactInr(c.billed)}</span></Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{compactInr(c.collected)}</span></Td>
                      <Td className="text-right">
                        <span className={`text-[11px] font-semibold ${c.outstanding > 0 ? "text-[#8A6420]" : "text-muted"}`}>{compactInr(c.outstanding)}</span>
                      </Td>
                      <Td className="text-right"><span className="text-[11px] text-muted">{c.wipHours || "—"}</span></Td>
                      <Td className="text-right"><span className="text-xs font-bold text-ink">{c.billed ? Math.round((c.collected / c.billed) * 100) : 0}%</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink">
              <Target className="h-4 w-4" /> Lead conversion
            </h2>
            <p className="text-[11px] text-muted">{data.pipeline.open} open · {data.pipeline.won} won · {data.pipeline.lost} lost</p>
          </div>
          <div className="rounded-2xl bg-sage px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sage-ink/70">Win rate</p>
            <p className="text-2xl font-extrabold text-sage-ink">{data.pipeline.conversion}%</p>
          </div>
          <div className="mt-4 space-y-2">
            {data.pipeline.byStage.map((s) => (
              <div key={s.stage} className="flex items-center justify-between text-[11px]">
                <span className="text-muted">{s.stage}</span>
                <span className="font-semibold text-ink">{s.count}</span>
              </div>
            ))}
          </div>
          <Link href="/leads" className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-green hover:underline">
            Work the pipeline <ArrowUpRight className="h-3 w-3" />
          </Link>
        </Card>
      </div>

      <Card className="mt-3 flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-[11px] text-muted">Download raw data for Excel or your accountant — UTF-8 CSV, one file per register.</p>
        <div className="flex flex-wrap gap-1.5">
          {EXPORTS.map((e) => (
            <a
              key={e.type}
              href={`/api/export?type=${e.type}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-semibold text-ink transition hover:bg-subtle"
            >
              <Download className="h-3 w-3" /> {e.label}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon, tone = "sage" }: { label: string; value: string; icon: React.ReactNode; tone?: "sage" | "green" | "gold" | "rose" }) {
  const tones = {
    sage: "bg-subtle text-ink",
    green: "bg-sage text-sage-ink",
    gold: "bg-gold-soft text-gold",
    rose: "bg-[#FBEAE7] text-[#A33B2E]",
  };
  return (
    <div className="card flex items-center gap-2.5 p-3.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-base font-extrabold leading-tight text-ink">{value}</p>
      </div>
    </div>
  );
}

function Mini({ label, value, hint, tone = "sage" }: { label: string; value: string; hint: string; tone?: "sage" | "rose" }) {
  return (
    <div className={`rounded-xl px-2.5 py-2 ${tone === "rose" ? "bg-[#FBEAE7]" : "bg-subtle"}`}>
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-sm font-extrabold ${tone === "rose" ? "text-[#A33B2E]" : "text-ink"}`}>{value}</p>
      <p className="text-[9px] leading-tight text-muted">{hint}</p>
    </div>
  );
}
