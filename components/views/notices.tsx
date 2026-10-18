"use client";

import * as React from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Plus } from "lucide-react";
import type { Notice } from "@/lib/types";
import { Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { dayDiff, inr, prettyDate } from "@/lib/format";

const FILTERS = ["All", "Open", "Response Filed", "Escalated", "Closed"] as const;
type Filter = (typeof FILTERS)[number];

export function NoticesView({ notices, clients }: { notices: Notice[]; clients: string[] }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    client_name: clients[0] ?? "",
    notice_type: "ASMT-10 — Scrutiny of Returns",
    portal: "GST",
    notice_date: new Date().toISOString().slice(0, 10),
    response_deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    reference_number: "",
    amount: 0,
    notes: "",
  });

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return notices.filter((n) => {
      const matchesFilter = filter === "All" || n.status === filter;
      const matchesQuery = !q || [n.client_name, n.notice_type, n.reference_number, n.portal].join(" ").toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [notices, filter, query]);

  const open = notices.filter((n) => n.status === "Open").length;
  const escalated = notices.filter((n) => n.status === "Escalated").length;
  const disputed = notices.reduce((s, n) => s + n.amount, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Notice>("/api/notices", "POST", form, "Notice logged");
    if (created) setAddOpen(false);
  }

  async function setStatus(notice: Notice, status: Notice["status"]) {
    await mutate<Notice>(`/api/notices/${notice.notice_id}`, "PATCH", { status }, `Notice marked ${status.toLowerCase()}`);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Risk desk"
        title="Notice inbox"
        description="GST and income-tax notices with response deadlines and dispute values."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Log notice
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Open" value={open} tone="rose" />
        <MiniStat label="Escalated" value={escalated} tone="gold" />
        <MiniStat label="Total notices" value={notices.length} />
        <MiniStat label="Amount in dispute" value={inr(disputed)} />
      </div>

      <SectionCard
        title={`${filtered.length} notices`}
        subtitle="Deadlines are tracked in IST against the response due date"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search notices…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="No notices in this view" description="Log a notice to start tracking its response deadline." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Notice</Th>
                  <Th>Client</Th>
                  <Th>Portal</Th>
                  <Th>Deadline</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => {
                  const days = dayDiff(n.response_deadline);
                  const urgent = days <= 3 && n.status !== "Closed";
                  return (
                    <tr key={n.notice_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                      <Td>
                        <p className="text-xs font-semibold text-ink">{n.notice_type}</p>
                        <p className="font-mono text-[10px] text-muted">{n.reference_number || n.notice_id}</p>
                      </Td>
                      <Td><span className="text-xs text-ink">{n.client_name}</span></Td>
                      <Td><Badge tone="neutral">{n.portal}</Badge></Td>
                      <Td>
                        <p className={`text-xs font-semibold ${urgent ? "text-[#A33B2E]" : "text-ink"}`}>{prettyDate(n.response_deadline)}</p>
                        <p className={`text-[10px] ${urgent ? "text-[#A33B2E]" : "text-muted"}`}>
                          {days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `${days} days left`}
                        </p>
                      </Td>
                      <Td className="text-right"><span className="text-xs font-semibold text-ink">{n.amount ? inr(n.amount) : "—"}</span></Td>
                      <Td><StatusPill status={n.status} /></Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {n.status !== "Closed" ? (
                            <>
                              <AiAssist task="notice_draft" id={n.notice_id} label="Draft reply" variant="ghost" title={`${n.notice_type} — reply outline`} />
                              <Button size="sm" variant="ghost" onClick={() => setStatus(n, "Escalated")} loading={busy}>Escalate</Button>
                              <Button size="sm" variant="soft" onClick={() => setStatus(n, "Response Filed")} loading={busy}>
                                <ArrowUpRight className="h-3.5 w-3.5" /> Respond
                              </Button>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#3E8A52]"><CheckCircle2 className="h-3.5 w-3.5" /> Closed</span>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Log a notice" description="Capture the notice reference, dispute value and response deadline.">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client" className="sm:col-span-2">
              <select className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}>
                {clients.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Notice type" className="sm:col-span-2">
              <input required className="input" value={form.notice_type} onChange={(e) => setForm({ ...form, notice_type: e.target.value })} placeholder="ASMT-10 — Scrutiny of Returns" />
            </Field>
            <Field label="Portal">
              <select className="input" value={form.portal} onChange={(e) => setForm({ ...form, portal: e.target.value })}>
                {["GST", "Income Tax", "MCA", "Customs", "Other"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Reference number"><input className="input" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} /></Field>
            <Field label="Notice date"><input type="date" className="input" value={form.notice_date} onChange={(e) => setForm({ ...form, notice_date: e.target.value })} /></Field>
            <Field label="Response deadline"><input required type="date" className="input" value={form.response_deadline} onChange={(e) => setForm({ ...form, response_deadline: e.target.value })} /></Field>
            <Field label="Amount in dispute"><input type="number" min={0} className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Log notice</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, tone = "sage" }: { label: string; value: number | string; tone?: "sage" | "gold" | "rose" }) {
  const tones = { sage: "text-ink", gold: "text-[#8A6420]", rose: "text-[#A33B2E]" };
  return (
    <div className="card p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold ${tones[tone]}`}>{value}</p>
    </div>
  );
}
