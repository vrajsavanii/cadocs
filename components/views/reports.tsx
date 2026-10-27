"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  Building2,
  CalendarCheck2,
  ClipboardCheck,
  Clock3,
  Download,
  FileSpreadsheet,
  Inbox,
  Landmark,
  MessageSquare,
  ReceiptIndianRupee,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { AuthUser, ReportFilters } from "@/lib/types";
import type { ExceptionItem, UnifiedReports } from "@/lib/reports";
import { Badge, Card, EmptyState, PageHeader, Progress, StatusPill, TableShell, Td, Th } from "@/components/ui";
import { RevenueChart } from "@/components/charts";
import { compactInr, inr } from "@/lib/format";

export type FilterOptions = {
  clients: Array<{ id: string; name: string }>;
  staff: Array<{ name: string; role: string }>;
  services: Array<{ code: string; name: string }>;
  fyOptions: string[];
};

type Pack = UnifiedReports & { filter_warnings?: string[] };

const SECTIONS = [
  { key: "overview", label: "Overview", icon: <Landmark className="h-3.5 w-3.5" /> },
  { key: "deadlines", label: "Deadlines", icon: <CalendarCheck2 className="h-3.5 w-3.5" /> },
  { key: "clients", label: "Clients", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "documents", label: "Documents", icon: <Inbox className="h-3.5 w-3.5" /> },
  { key: "staff", label: "Staff", icon: <Users className="h-3.5 w-3.5" /> },
  { key: "reviews", label: "Reviews", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
  { key: "collections", label: "Collections", icon: <ReceiptIndianRupee className="h-3.5 w-3.5" /> },
  { key: "communications", label: "Comms", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { key: "annual", label: "ITR / Audit", icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
  { key: "exceptions", label: "Attention", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

const INVOICE_STATUSES = ["Draft", "Sent", "Partial", "Paid", "Cancelled"];
const PAYMENT_STATUSES = ["Recorded", "Pending", "Failed"];

export function ReportsView({
  pack,
  user,
  options,
}: {
  pack: Pack;
  user: AuthUser | null;
  options: FilterOptions;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const initial: SectionKey = (params.get("section") as SectionKey) in SECTIONS ? (params.get("section") as SectionKey) : "overview";
  const [section, setSection] = React.useState<SectionKey>(initial);
  const supervisory = pack.scope === "full";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("section", section);
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/reports?${next.toString()}`);
  };
  const applyDates = (from: string, to: string) => {
    const next = new URLSearchParams(params.toString());
    if (from) next.set("from", from);
    else next.delete("from");
    if (to) next.set("to", to);
    else next.delete("to");
    router.push(`/reports?${next.toString()}`);
  };

  const pickSection = (key: SectionKey) => {
    const next = new URLSearchParams(params.toString());
    next.set("section", key);
    setSection(key);
    router.replace(`/reports?${next.toString()}`);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Practice intelligence"
        title="Firm reports"
        description="One pack of ten linked reports over the firm's own records — deadlines, delivery, documents, workload, reviews, collections, annual ITR/audit progress and operations."
      >
        <a
          href={`/api/reports?${params.toString()}`}
          target="_blank"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
        >
          <Download className="h-3.5 w-3.5" /> JSON
        </a>
        <Link
          href="/api/export?type=invoices"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-ink transition hover:bg-subtle"
        >
          <Download className="h-3.5 w-3.5" /> CSV registers
        </Link>
      </PageHeader>

      <FilterBar pack={pack} options={options} supervisory={supervisory} onDateApply={applyDates} />

      <nav className="mb-3 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => pickSection(s.key)}
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
              section === s.key ? "bg-ink text-white" : "border border-black/10 bg-white text-ink hover:bg-subtle"
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </nav>

      {pack.filter_warnings && pack.filter_warnings.length > 0 ? (
        <Card className="mb-3 flex items-start gap-2 border-[#C98A3E]/40 bg-[#FDF6EA] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8A6420]" />
          <p className="text-[11px] text-[#8A6420]">Some filters were ignored: {pack.filter_warnings.join(" · ")}</p>
        </Card>
      ) : null}

      {section === "overview" ? <Overview pack={pack} onJump={pickSection} /> : null}
      {section === "deadlines" ? <Deadlines pack={pack} /> : null}
      {section === "clients" ? <Clients pack={pack} /> : null}
      {section === "documents" ? <Documents pack={pack} /> : null}
      {section === "staff" ? <Staff pack={pack} /> : null}
      {section === "reviews" ? <Reviews pack={pack} /> : null}
      {section === "collections" ? <Collections pack={pack} /> : null}
      {section === "communications" ? <Communications pack={pack} /> : null}
      {section === "annual" ? <Annual pack={pack} /> : null}
      {section === "exceptions" ? <Exceptions pack={pack} /> : null}

      <Card className="mt-3 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-ink">
          <ShieldCheck className="h-3.5 w-3.5" /> How these numbers are built
        </p>
        <ul className="space-y-1">
          {pack.basis.map((b) => (
            <li key={b} className="text-[11px] leading-relaxed text-muted">· {b}</li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-muted">
          Generated {new Date(pack.generated_at).toLocaleString("en-IN")} · scope {pack.scope}
          {user ? ` · viewer ${user.name} (${user.role})` : ""}
        </p>
      </Card>
    </div>
  );
}

// ── filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  pack,
  options,
  supervisory,
  onDateApply,
}: {
  pack: Pack;
  options: FilterOptions;
  supervisory: boolean;
  onDateApply: (from: string, to: string) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const [from, setFrom] = React.useState(get("from"));
  const [to, setTo] = React.useState(get("to"));
  const f = pack.filters;

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("section");
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/reports?${next.toString()}`);
  };
  const dirty = Array.from(params.keys()).some((k) => k !== "section");

  const select = (key: keyof ReportFilters, label: string, opts: Array<{ value: string; label: string }>) => (
    <label className="flex min-w-[130px] flex-1 flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <select
        value={get(key as string)}
        onChange={(e) => set(key as string, e.target.value)}
        className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-semibold text-ink"
      >
        <option value="">All</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card className="mb-3 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Global filters · validated server-side</p>
        {dirty ? (
          <button type="button" onClick={() => router.push("/reports")} className="text-[11px] font-bold text-green hover:underline">
            Clear all filters
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {select("client_id", "Client", options.clients.map((c) => ({ value: c.id, label: c.name })))}
        {select("fy", "Financial year", options.fyOptions.map((y) => ({ value: y, label: `FY ${y}` })))}
        {select("service_code", "Service", options.services.map((s) => ({ value: s.code, label: s.name })))}
        {select(
          "compliance_id",
          "Engagement",
          Array.from(
            new Map(
              pack.deadlines.rows.map((r) => [r.compliance_id, `${r.client} — ${r.type} ${r.period}`]),
            ).entries(),
          )
            .slice(0, 60)
            .map(([value, label]) => ({ value, label })),
        )}
        {supervisory ? select("assigned_to", "Staff", options.staff.map((s) => ({ value: s.name, label: s.name }))) : null}
        {supervisory ? select("preparer", "Preparer", options.staff.map((s) => ({ value: s.name, label: s.name }))) : null}
        {supervisory ? select("reviewer", "Reviewer", options.staff.map((s) => ({ value: s.name, label: s.name }))) : null}
        {supervisory ? select("invoice_status", "Invoice status", INVOICE_STATUSES.map((s) => ({ value: s, label: s }))) : null}
        {supervisory ? select("payment_status", "Payment status", PAYMENT_STATUSES.map((s) => ({ value: s, label: s }))) : null}
        <div className="flex items-end gap-1">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-semibold text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-semibold text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => onDateApply(from, to)}
            className="mb-0 h-8 rounded-lg bg-ink px-3 text-[11px] font-bold text-white"
          >
            Apply
          </button>
        </div>
      </div>
      {f.fy || f.client_id || f.service_code || f.from || f.to ? (
        <p className="mt-2 text-[10px] text-muted">
          Active: {[
            f.fy ? `FY ${f.fy}` : "",
            f.assessment_year ? `AY ${f.assessment_year}` : "",
            f.client_id ? `client ${options.clients.find((c) => c.id === f.client_id)?.name ?? f.client_id}` : "",
            f.service_code || "",
            f.period ? `period ${f.period}` : "",
            f.from || f.to ? `${f.from || "…"} → ${f.to || "…"}` : "",
          ].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </Card>
  );
}

// ── section panels ───────────────────────────────────────────────────────────

function Overview({ pack, onJump }: { pack: Pack; onJump: (s: SectionKey) => void }) {
  const o = pack.overview;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Active clients" value={`${o.clients.active}`} hint={`${o.clients.total} total`} icon={<Building2 className="h-4 w-4" />} />
        <Kpi label="Open work" value={`${o.engagements.open}`} hint={`of ${o.engagements.total} engagements`} icon={<CalendarCheck2 className="h-4 w-4" />} />
        <Kpi label="Overdue" value={`${o.engagements.overdue}`} hint={`${o.engagements.due_soon} due in 7 days`} tone="rose" icon={<Clock3 className="h-4 w-4" />} />
        <Kpi label="Awaiting docs" value={`${o.engagements.awaiting_documents}`} hint={`${o.documents.requests_open} open requests`} tone="gold" icon={<Inbox className="h-4 w-4" />} />
        <Kpi label="In preparation" value={`${o.engagements.in_preparation}`} hint={`${o.engagements.in_preparation} in preparation`} icon={<FileSpreadsheet className="h-4 w-4" />} />
        <Kpi label="Awaiting review" value={`${o.engagements.awaiting_review}`} hint={`${o.engagements.awaiting_correction} corrected before`} tone="gold" icon={<ClipboardCheck className="h-4 w-4" />} />
        <Kpi label="Filed w/ evidence" value={`${o.engagements.completed_with_evidence}`} hint={`${o.engagements.filed_without_evidence} filed, evidence missing`} tone="green" icon={<FileSpreadsheet className="h-4 w-4" />} />
        <Kpi label="Blocked" value={`${o.engagements.blocked}`} hint={`${o.engagements.unassigned} unassigned`} tone={o.engagements.blocked ? "rose" : "sage"} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {o.billing ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-extrabold tracking-tight text-ink">Billing pulse</h2>
              <Link href="/invoices" className="text-[11px] font-bold text-green hover:underline">Invoices <ArrowUpRight className="inline h-3 w-3" /></Link>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Mini label="Outstanding" value={compactInr(o.billing.outstanding_rupees)} hint={`${o.billing.invoices_open} open invoice(s)`} />
              <Mini label="Overdue" value={compactInr(o.billing.overdue_rupees)} hint={`${o.billing.overdue_invoices} invoice(s) past due`} tone="rose" />
              <Mini label="Unbilled work" value={compactInr(o.billing.unbilled_value_rupees)} hint={`${o.billing.unbilled_completed_cycles} completed cycle(s) not yet billed`} tone="gold" />
            </div>
          </Card>
        ) : null}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-extrabold tracking-tight text-ink">Communications (30 days)</h2>
            <button type="button" onClick={() => onJump("communications")} className="text-[11px] font-bold text-green hover:underline">Detail <ArrowUpRight className="inline h-3 w-3" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Mini label="Sent" value={`${o.communications.sent_window}`} hint="WhatsApp dispatches succeeded" />
            <Mini label="Failed" value={`${o.communications.failed_window}`} hint="Provider errors — retriable" tone={o.communications.failed_window ? "rose" : "sage"} />
            <Mini label="Doc reminders" value={`${o.documents.reminders_sent_window}`} hint="Automated collection nudges" />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">Needs attention now</h2>
          <button type="button" onClick={() => onJump("exceptions")} className="text-[11px] font-bold text-green hover:underline">Full queue</button>
        </div>
        {pack.exceptions.length === 0 ? (
          <EmptyState icon={<Landmark className="h-5 w-5" />} title="Nothing needs management attention" description="Every engagement, review and invoice is within its normal thresholds, based on the records in this pack." />
        ) : (
          <ul className="divide-y divide-black/5">
            {pack.exceptions.slice(0, 8).map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-xs font-bold text-ink">{e.title}</p>
                  <p className="text-[11px] text-muted">{e.detail}</p>
                </div>
                <Link href={e.href} className="shrink-0 text-[11px] font-bold text-green hover:underline">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Deadlines({ pack }: { pack: Pack }) {
  const d = pack.deadlines;
  const bucketTone: Record<string, string> = {
    overdue: "bg-[#FBEAE7] text-[#A33B2E]",
    due_today: "bg-[#FDF6EA] text-[#8A6420]",
    due_soon: "bg-subtle text-ink",
    not_yet_due: "bg-subtle text-ink",
    awaiting_review: "bg-[#FDF6EA] text-[#8A6420]",
    awaiting_filing_evidence: "bg-[#FBEAE7] text-[#A33B2E]",
    blocked: "bg-[#FBEAE7] text-[#A33B2E]",
    completed_on_time: "bg-sage text-sage-ink",
    completed_late: "bg-[#FDF6EA] text-[#8A6420]",
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {Object.entries(d.buckets).map(([k, v]) => (
          <div key={k} className={`rounded-xl px-2.5 py-2 ${bucketTone[k] ?? "bg-subtle"}`}>
            <p className="text-[9px] font-bold uppercase tracking-wide opacity-80">{k.replace(/_/g, " ")}</p>
            <p className="text-sm font-extrabold">{v}</p>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">By configured service</h2>
          <p className="text-[11px] text-muted">Statutory vs internal target dates are preserved per row</p>
        </div>
        {d.byService.length === 0 ? (
          <EmptyState title="No engagements match the filters" />
        ) : (
          <TableShell>
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Service</Th>
                  <Th className="text-right">Open</Th>
                  <Th className="text-right">Overdue</Th>
                  <Th className="text-right">Completed</Th>
                </tr>
              </thead>
              <tbody>
                {d.byService.map((s) => (
                  <tr key={s.service_code} className="border-t border-black/5">
                    <Td><span className="text-xs font-semibold text-ink">{s.label}</span></Td>
                    <Td className="text-right text-[11px] text-muted">{s.open}</Td>
                    <Td className={`text-right text-[11px] font-semibold ${s.overdue ? "text-[#A33B2E]" : "text-muted"}`}>{s.overdue}</Td>
                    <Td className="text-right text-[11px] text-muted">{s.completed}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">Engagement register</h2>
          <p className="text-[11px] text-muted">Sorted by due date{d.rows_capped ? ` · showing 400 of more rows; totals above cover all matches` : ""}</p>
        </div>
        {d.rows.length === 0 ? (
          <EmptyState title="No engagements match the filters" />
        ) : (
          <TableShell>
            <table className="w-full min-w-[980px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Client</Th><Th>Engagement</Th><Th>Due</Th><Th>Basis</Th><Th>Stage</Th><Th>Preparer</Th><Th>Reviewer</Th><Th className="text-right">Docs</Th><Th>Filing</Th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.compliance_id} className="border-t border-black/5">
                    <Td><Link href={`/clients?client=${r.client_id}`} className="text-xs font-semibold text-green hover:underline">{r.client}</Link></Td>
                    <Td><Link href={`/workflow?task=${r.compliance_id}`} className="text-xs text-ink hover:underline">{r.type} · {r.period}</Link></Td>
                    <Td>
                      <span className="text-[11px] font-semibold text-ink">{r.due_date}</span>
                      {r.days_overdue > 0 ? <span className="ml-1 text-[10px] font-bold text-[#A33B2E]">{r.days_overdue}d late</span> : null}
                    </Td>
                    <Td><Badge tone="neutral">{r.due_date_source || "operative"}</Badge></Td>
                    <Td><StatusPill status={r.stage} /></Td>
                    <Td className="text-[11px] text-muted">{r.preparer || "—"}</Td>
                    <Td className="text-[11px] text-muted">{r.reviewer || "—"}</Td>
                    <Td className="text-right text-[11px] text-muted">{r.docs_pending}</Td>
                    <Td>{r.filing_evidence_recorded ? <Badge tone="green">Evidence</Badge> : r.ack_number ? <Badge tone="blue">ACK only</Badge> : <Badge tone="amber">None</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

function Clients({ pack }: { pack: Pack }) {
  const rows = pack.clientDelivery;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-sm font-extrabold tracking-tight text-ink">Client service delivery</h2>
        <p className="text-[11px] text-muted">One row per client record — registrations and multiple engagements never multiply a client.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No clients match the filters" />
      ) : (
        <TableShell>
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="bg-subtle/60">
                <Th>Client</Th><Th>Status</Th><Th>Services</Th><Th className="text-right">Open</Th><Th>Stage</Th><Th>Preparer</Th><Th>Reviewer</Th><Th className="text-right">Docs due</Th><Th>Next deadline</Th><Th>FY/AY drill</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.client_id} className="border-t border-black/5">
                  <Td><Link href={`/clients?client=${c.client_id}`} className="text-xs font-semibold text-green hover:underline">{c.client}</Link></Td>
                  <Td><Badge tone={c.status === "Exited" ? "neutral" : "green"}>{c.status}</Badge></Td>
                  <Td><span className="text-[11px] text-muted">{c.services.slice(0, 3).join(", ") || "—"}</span></Td>
                  <Td className="text-right text-[11px] text-muted">{c.open_engagements}</Td>
                  <Td>{c.current_stage ? <StatusPill status={c.current_stage} /> : <span className="text-[11px] text-muted">—</span>}</Td>
                  <Td className="text-[11px] text-muted">{c.preparer || "—"}</Td>
                  <Td className="text-[11px] text-muted">{c.reviewer || "—"}</Td>
                  <Td className="text-right text-[11px] text-muted">{c.outstanding_requirements}{c.open_blockers ? <span className="ml-1 text-[10px] font-bold text-[#A33B2E]">+{c.open_blockers} blocked</span> : null}</Td>
                  <Td className="text-[11px] text-muted">{c.next_deadline ?? "—"}</Td>
                  <Td>
                    <Link href={`/clients?client=${c.client_id}`} className="text-[11px] font-bold text-green hover:underline">History <ArrowUpRight className="inline h-3 w-3" /></Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </Card>
  );
}

function Documents({ pack }: { pack: Pack }) {
  const d = pack.documents;
  const maxByService = Math.max(1, ...d.byService.map((s) => s.open + s.cleared));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Kpi label="Open requirements" value={`${d.totals.requirements_open}`} hint="Requested, not yet received" icon={<Inbox className="h-4 w-4" />} />
        <Kpi label="Cleared" value={`${d.totals.cleared}`} hint={`${d.totals.cleared_rate_percent}% of all requests`} tone="green" icon={<CalendarCheck2 className="h-4 w-4" />} />
        <Kpi label="At reminder cap" value={`${d.totals.at_reminder_cap}`} hint="No more automated nudges left" tone="rose" icon={<BellRing className="h-4 w-4" />} />
        <Kpi label="Avg days to clear" value={d.totals.avg_days_to_clear === null ? "—" : `${d.totals.avg_days_to_clear}`} hint="From request to cleared" icon={<Clock3 className="h-4 w-4" />} />
        <Kpi label="Oldest request" value={d.oldest[0] ? `${d.oldest[0].days_open}d` : "—"} hint={d.oldest[0] ? d.oldest[0].client : "no open requests"} tone="gold" icon={<Clock3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-extrabold tracking-tight text-ink">By service</h2>
          {d.byService.length === 0 ? <p className="py-4 text-center text-xs text-muted">No document requests yet.</p> : (
            <div className="space-y-2">
              {d.byService.map((s) => (
                <div key={s.service_code}>
                  <div className="mb-1 flex justify-between text-[11px] font-semibold">
                    <span className="text-muted">{s.service_code}</span>
                    <span className="text-ink">{s.cleared}/{s.open + s.cleared} cleared</span>
                  </div>
                  <Progress value={maxByService ? ((s.cleared / (s.open + s.cleared)) * 100) : 0} tone={s.cleared >= s.open ? "green" : "amber"} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 pb-3 pt-5">
            <h2 className="text-sm font-extrabold tracking-tight text-ink">Oldest open requests</h2>
            <p className="text-[11px] text-muted">Compiled from the request ledger; chases earned seconds vs stale items</p>
          </div>
          {d.oldest.length === 0 ? (
            <EmptyState title="No open document requests" />
          ) : (
            <TableShell>
              <table className="w-full min-w-[520px]">
                <thead><tr className="bg-subtle/60"><Th>Client</Th><Th>Eng</Th><Th>Period</Th><Th className="text-right">Days open</Th><Th className="text-right">Reminders</Th></tr></thead>
                <tbody>
                  {d.oldest.slice(0, 15).map((r) => (
                    <tr key={r.request_id} className="border-t border-black/5">
                      <Td><Link href={`/clients?client=${r.client_id}`} className="text-xs font-semibold text-green hover:underline">{r.client}</Link></Td>
                      <Td className="text-[11px] text-muted">{r.service_code}</Td>
                      <Td className="text-[11px] text-muted">{r.period}</Td>
                      <Td className="text-right text-[11px] font-semibold text-ink">{r.days_open}</Td>
                      <Td className="text-right text-[11px] text-muted">{r.reminders_sent}/{r.reminder_cap}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>
      </div>
    </div>
  );
}

function Staff({ pack }: { pack: Pack }) {
  if (pack.staff.length === 0) return <EmptyState icon={<Users className="h-5 w-5" />} title="Staff workload is partner/manager view only" description="Other roles see their own assignments in Workflow instead." />;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-sm font-extrabold tracking-tight text-ink">Staff workload & productivity</h2>
        <p className="text-[11px] text-muted">Completed-in-window uses recorded completion dates; hours come from timesheets (all statuses shown, billable split included).</p>
      </div>
      <TableShell>
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="bg-subtle/60">
              <Th>Staff</Th><Th>Role</Th><Th className="text-right">Open</Th><Th className="text-right">Overdue</Th><Th className="text-right">Due 7d</Th><Th className="text-right">Their reviews</Th><Th className="text-right">Completed</Th><Th className="text-right">Hours</Th><Th className="text-right">Billable h</Th>
            </tr>
          </thead>
          <tbody>
            {pack.staff.map((s) => (
              <tr key={s.staff} className="border-t border-black/5">
                <Td><span className="text-xs font-semibold text-ink">{s.staff}</span></Td>
                <Td><Badge tone="neutral">{s.role}</Badge></Td>
                <Td className="text-right text-[11px] text-muted">{s.open_engagements}</Td>
                <Td className={`text-right text-[11px] font-semibold ${s.overdue ? "text-[#A33B2E]" : "text-muted"}`}>{s.overdue}</Td>
                <Td className="text-right text-[11px] text-muted">{s.due_soon}</Td>
                <Td className="text-right text-[11px] text-muted">{s.awaiting_their_review}</Td>
                <Td className="text-right text-[11px] text-muted">{s.completed_in_window}</Td>
                <Td className="text-right text-[11px] text-muted">{s.total_hours}</Td>
                <Td className="text-right text-[11px] text-muted">{s.billable_hours}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Card>
  );
}

function Reviews({ pack }: { pack: Pack }) {
  const r = pack.reviews;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi label="Pending reviews" value={`${r.total_pending}`} hint="Engagements sitting in the review stage" icon={<ClipboardCheck className="h-4 w-4" />} />
        <Kpi label="Oldest in review" value={r.oldest_days === null ? "—" : `${r.oldest_days}d`} hint="Longest current review dwell" tone={r.oldest_days && r.oldest_days > 5 ? "gold" : "sage"} icon={<Clock3 className="h-4 w-4" />} />
        <Kpi label="Rejected to prep" value={`${r.rejected_back_to_prep.size}`} hint="Historic review rejections (correction loop)" tone="rose" icon={<AlertTriangle className="h-4 w-4" />} />
      </div>
      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">Review queue</h2>
          <p className="text-[11px] text-muted">Dwell is measured from the latest recorded entry into review (task events) — and falls back to the stage timestamp when events are absent.</p>
        </div>
        {r.rows.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No work is waiting for review" />
        ) : (
          <TableShell>
            <table className="w-full min-w-[720px]">
              <thead><tr className="bg-subtle/60"><Th>Engagement</Th><Th>Reviewer</Th><Th>In review since</Th><Th className="text-right">Days</Th><Th className="text-right">Rounds</Th></tr></thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.compliance_id} className="border-t border-black/5">
                    <Td><Link href={`/workflow?task=${row.compliance_id}`} className="text-xs font-semibold text-green hover:underline">{row.client} · {row.type} {row.period}</Link></Td>
                    <Td className="text-[11px] text-muted">{row.reviewer || "—"}</Td>
                    <Td className="text-[11px] text-muted">{row.stage_since ?? "—"}</Td>
                    <Td className="text-right text-[11px] font-semibold text-ink">{row.days_in_review}</Td>
                    <Td className="text-right text-[11px] text-muted">{row.review_rounds}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

function Collections({ pack }: { pack: Pack }) {
  if (!pack.collections) return null;
  const c = pack.collections;
  const maxTotal = Math.max(1, ...c.monthly.map((m) => m.billed_rupees));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Billed" value={compactInr(c.totals.billed_rupees)} hint="Active invoices incl. paid" icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Kpi label="Collected" value={compactInr(c.totals.collected_rupees)} hint="Recorded ledger payments" tone="green" icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Kpi label="Outstanding" value={compactInr(c.totals.outstanding_rupees)} hint={`${c.totals.open_count} open`} tone="gold" icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Kpi label="Overdue" value={compactInr(c.totals.overdue_rupees)} hint={`${c.totals.overdue_count} past due`} tone="rose" icon={<Clock3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-extrabold tracking-tight text-ink">Receivables ageing</h2>
          <div className="space-y-2.5">
            {c.aging.map((b) => (
              <div key={b.bucket}>
                <div className="mb-1 flex justify-between text-[11px] font-semibold">
                  <span className="text-muted">{b.bucket} <span className="text-muted/70">({b.count})</span></span>
                  <span className="text-ink">{inr(b.amount_rupees)}</span>
                </div>
                <Progress value={(b.amount_rupees / Math.max(1, ...c.aging.map((x) => x.amount_rupees))) * 100} tone={b.bucket === "90+ days" ? "red" : b.bucket === "Not due" ? "green" : "amber"} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted">{c.basis_note}</p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-extrabold tracking-tight text-ink">Billed vs collected</h2>
          <RevenueChart data={c.monthly.map((m) => ({ month: m.month, billed: m.billed_rupees, collected: m.collected_rupees }))} />
          <p className="mt-3 text-[11px] text-muted">Last six calendar months from invoice issue dates and recorded payments.</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-5"><h2 className="text-sm font-extrabold tracking-tight text-ink">Overdue invoices</h2></div>
        {c.overdueRows.length === 0 ? <EmptyState icon={<ReceiptIndianRupee className="h-5 w-5" />} title="Nothing overdue" /> : (
          <TableShell>
            <table className="w-full min-w-[640px]">
              <thead><tr className="bg-subtle/60"><Th>Invoice</Th><Th>Client</Th><Th>Due</Th><Th className="text-right">Balance</Th><Th className="text-right">Days late</Th></tr></thead>
              <tbody>
                {c.overdueRows.map((i) => (
                  <tr key={i.invoice_id} className="border-t border-black/5">
                    <Td><Link href="/invoices" className="text-xs font-semibold text-green hover:underline">{i.number}</Link></Td>
                    <Td className="text-[11px] text-muted">{i.client}</Td>
                    <Td className="text-[11px] text-muted">{i.due_date}</Td>
                    <Td className="text-right text-[11px] font-semibold text-ink">{inr(i.balance_rupees)}</Td>
                    <Td className="text-right text-[11px] text-[#A33B2E]">{i.days_overdue}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}

function Communications({ pack }: { pack: Pack }) {
  const c = pack.communications;
  const statuses = Object.entries(c.byStatus);
  const statusTotal = statuses.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-extrabold tracking-tight text-ink">Delivery by status</h2>
          {statuses.length === 0 ? <p className="py-4 text-center text-xs text-muted">No messages in the window.</p> : statuses.map(([k, v]) => (
            <div key={k} className="mb-2">
              <div className="mb-1 flex justify-between text-[11px] font-semibold"><span className="text-muted">{k}</span><span className="text-ink">{v}</span></div>
              <Progress value={(v / Math.max(1, statusTotal)) * 100} tone={/fail|err/i.test(k) ? "red" : /sent|deliv/i.test(k) ? "green" : "amber"} />
            </div>
          ))}
          <h2 className="mb-2 mt-4 text-sm font-extrabold tracking-tight text-ink">By message kind</h2>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(c.byKind).map(([k, v]) => (
              <Badge key={k} tone="neutral">{k}: {v}</Badge>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 pb-3 pt-5">
            <h2 className="text-sm font-extrabold tracking-tight text-ink">Recent failures</h2>
            <p className="text-[11px] text-muted">Retriable provider errors — never counted as delivered.</p>
          </div>
          {c.failures.length === 0 ? <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No failed messages" /> : (
            <TableShell>
              <table className="w-full min-w-[480px]">
                <thead><tr className="bg-subtle/60"><Th>Recipient</Th><Th>Kind</Th><Th>Error</Th><Th>When</Th></tr></thead>
                <tbody>
                  {c.failures.map((m) => (
                    <tr key={m.message_id} className="border-t border-black/5">
                      <Td className="text-xs font-semibold text-ink">{m.recipient}</Td>
                      <Td className="text-[11px] text-muted">{m.kind}</Td>
                      <Td className="text-[11px] text-[#A33B2E]">{m.error || "provider error"}</Td>
                      <Td className="text-[11px] text-muted">{m.created_at.slice(0, 16).replace("T", " ")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>
      </div>
      <Card className="p-4"><p className="text-[11px] text-muted">{c.basis_note}</p></Card>
    </div>
  );
}

function Annual({ pack }: { pack: Pack }) {
  const a = pack.annual;
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-5">
          <h2 className="text-sm font-extrabold tracking-tight text-ink">Annual ITR & tax-audit progress by assessment year</h2>
          <p className="text-[11px] text-muted">{a.basis_note}</p>
        </div>
        {a.byAssessmentYear.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="h-5 w-5" />} title="No ITR or audit engagements found" description="Progress appears once annual income-tax or audit work exists on clients." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Assessment year</Th>
                  <Th className="text-right">ITRs</Th><Th className="text-right">Filed</Th><Th className="text-right">Filing evidence</Th>
                  <Th className="text-right">Audits</Th><Th className="text-right">Completed w/ evidence</Th>
                </tr>
              </thead>
              <tbody>
                {a.byAssessmentYear.map((y) => (
                  <tr key={y.assessment_year} className="border-t border-black/5">
                    <Td><span className="text-xs font-semibold text-ink">{y.assessment_year}</span></Td>
                    <Td className="text-right text-[11px] text-muted">{y.itr_total}</Td>
                    <Td className="text-right text-[11px] text-muted">{y.itr_filed}</Td>
                    <Td className="text-right text-[11px] font-semibold text-ink">{y.itr_filing_evidence}</Td>
                    <Td className="text-right text-[11px] text-muted">{y.audit_total}</Td>
                    <Td className="text-right text-[11px] font-semibold text-ink">{y.audit_completed}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      {a.rows.length ? (
        <Card className="overflow-hidden">
          <div className="px-5 pb-3 pt-5"><h2 className="text-sm font-extrabold tracking-tight text-ink">Engagement detail</h2></div>
          <TableShell>
            <table className="w-full min-w-[760px]">
              <thead><tr className="bg-subtle/60"><Th>Client</Th><Th>Kind</Th><Th>Type</Th><Th>AY</Th><Th>Stage</Th><Th>State</Th><Th>Filing</Th></tr></thead>
              <tbody>
                {a.rows.slice(0, 150).map((r) => (
                  <tr key={r.compliance_id} className="border-t border-black/5">
                    <Td><Link href={`/workflow?task=${r.compliance_id}`} className="text-xs font-semibold text-green hover:underline">{r.client}</Link></Td>
                    <Td><Badge tone={r.kind === "ITR" ? "blue" : "purple"}>{r.kind}</Badge></Td>
                    <Td className="text-[11px] text-muted">{r.type}</Td>
                    <Td className="text-[11px] text-muted">{r.assessment_year}</Td>
                    <Td><StatusPill status={r.stage} /></Td>
                    <Td className="text-[11px] text-muted">{r.state.replace(/_/g, " ")}</Td>
                    <Td>{r.filing_evidence_recorded ? <Badge tone="green">Evidence</Badge> : <Badge tone="amber">None</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </Card>
      ) : null}
    </div>
  );
}

const KIND_LABELS: Record<ExceptionItem["kind"], string> = {
  overdue_filing: "Overdue filing",
  unassigned_engagement: "Unassigned",
  long_pending_review: "Long review",
  blocked_engagement: "Blocked",
  overdue_invoice: "Overdue invoice",
  failed_job: "Failed job",
  failed_communication: "Failed message",
  awaiting_partner_approval: "Awaiting partner",
};

function Exceptions({ pack }: { pack: Pack }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-sm font-extrabold tracking-tight text-ink">Management attention queue</h2>
        <p className="text-[11px] text-muted">Every queue entry links to the underlying record and explains why it needs care.</p>
      </div>
      {pack.exceptions.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-5 w-5" />} title="Queue is clear" description="No critical overdue work, unassigned engagements, blocked items, overdue invoices or failed jobs in current records." />
      ) : (
        <ul className="divide-y divide-black/5">
          {pack.exceptions.map((e, i) => (
            <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
              <div className="min-w-[220px]">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <Badge tone={e.severity === "high" ? "red" : "amber"}>{KIND_LABELS[e.kind]}</Badge>
                  <span className="text-xs font-bold text-ink">{e.title}</span>
                </div>
                <p className="text-[11px] text-muted">{e.detail}</p>
              </div>
              <Link href={e.href} className="text-[11px] font-bold text-green hover:underline">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Kpi({ label, value, hint, tone = "sage", icon }: { label: string; value: string; hint?: string; tone?: "sage" | "green" | "gold" | "rose"; icon?: React.ReactNode }) {
  const tones = {
    sage: "bg-subtle text-ink",
    green: "bg-sage text-sage-ink",
    gold: "bg-gold-soft text-gold",
    rose: "bg-[#FBEAE7] text-[#A33B2E]",
  };
  const textTone = {
    sage: "text-ink",
    green: "text-ink",
    gold: "text-[#8A6420]",
    rose: "text-[#A33B2E]",
  };
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-2">
        {icon ? <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span> : null}
        <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
      </div>
      <p className={`mt-1 text-lg font-extrabold leading-tight ${textTone[tone]}`}>{value}</p>
      {hint ? <p className="truncate text-[9px] leading-tight text-muted">{hint}</p> : null}
    </div>
  );
}

function Mini({ label, value, hint, tone = "sage" }: { label: string; value: string; hint: string; tone?: "sage" | "gold" | "rose" }) {
  const bg = tone === "rose" ? "bg-[#FBEAE7]" : tone === "gold" ? "bg-gold-soft" : "bg-subtle";
  return (
    <div className={`rounded-xl px-2.5 py-2 ${bg}`}>
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-sm font-extrabold ${tone === "rose" ? "text-[#A33B2E]" : "text-ink"}`}>{value}</p>
      <p className="text-[9px] leading-tight text-muted">{hint}</p>
    </div>
  );
}
