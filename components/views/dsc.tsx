"use client";

import * as React from "react";
import { CalendarClock, KeyRound, Plus, ShieldAlert } from "lucide-react";
import type { Dsc } from "@/lib/types";
import { Badge, Button, EmptyState, Field, PageHeader, StatusPill } from "../ui";
import { Modal, useToast } from "../interactive";
import { SearchBox, useMutation } from "./shared";
import { dayDiff, prettyDate } from "@/lib/format";

export function DscView({ records, clients }: { records: Dsc[]; clients: string[] }) {
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    client_name: clients[0] ?? "",
    holder_name: "",
    class_type: "Class 3 Signing",
    valid_from: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    token_serial: "",
  });

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return records;
    return records.filter((r) => [r.client_name, r.holder_name, r.token_serial, r.class_type].join(" ").toLowerCase().includes(q));
  }, [records, query]);

  const active = records.filter((r) => r.status === "Active").length;
  const expiring = records.filter((r) => r.status === "Expiring Soon").length;
  const expired = records.filter((r) => r.status === "Expired").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Dsc>("/api/dsc", "POST", form, "DSC registration saved");
    if (created) setAddOpen(false);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Compliance infrastructure"
        title="DSC expiry tracker"
        description="Never miss a token renewal — signing certificates ranked by expiry."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Register DSC
        </Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <MiniStat label="Active" value={active} icon={<KeyRound className="h-4 w-4" />} />
        <MiniStat label="Expiring ≤30d" value={expiring} icon={<CalendarClock className="h-4 w-4" />} tone="gold" />
        <MiniStat label="Expired" value={expired} icon={<ShieldAlert className="h-4 w-4" />} tone="rose" />
      </div>

      <div className="mb-3 flex justify-end">
        <SearchBox value={query} onChange={setQuery} placeholder="Search DSC records…" className="w-full sm:w-64" />
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={<KeyRound className="h-5 w-5" />} title="No DSC records" description="Register a client's digital signing certificate to track expiry." />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const days = dayDiff(r.valid_until);
            const total = Math.max(1, dayDiff(r.valid_until) - dayDiff(r.valid_from));
            const left = Math.min(100, Math.max(0, Math.round((days / total) * 100)));
            const tone = r.status === "Expired" ? "red" : r.status === "Expiring Soon" ? "amber" : "green";
            return (
              <div key={r.dsc_id} className="card animate-rise p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${r.status === "Expired" ? "bg-[#FBEAE7] text-[#A33B2E]" : r.status === "Expiring Soon" ? "bg-gold-soft text-gold" : "bg-sage text-sage-ink"}`}>
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-ink">{r.holder_name}</p>
                      <p className="text-[11px] text-muted">{r.client_name}</p>
                    </div>
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl bg-subtle p-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Class</p>
                    <p className="mt-0.5 font-semibold text-ink">{r.class_type}</p>
                  </div>
                  <div className="rounded-xl bg-subtle p-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Token</p>
                    <p className="mt-0.5 font-mono font-semibold text-ink">{r.token_serial}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-semibold">
                    <span className="text-muted">Valid until {prettyDate(r.valid_until)}</span>
                    <span className={r.status === "Expired" ? "text-[#A33B2E]" : r.status === "Expiring Soon" ? "text-[#8A6420]" : "text-[#3E8A52]"}>
                      {days < 0 ? `${Math.abs(days)}d ago` : `${days}d left`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                    <div className={`h-full rounded-full ${tone === "red" ? "bg-[#C0503F]" : tone === "amber" ? "bg-[#C99235]" : "bg-green"}`} style={{ width: `${left}%` }} />
                  </div>
                </div>
                {r.status !== "Active" ? (
                  <Button size="sm" variant="soft" className="mt-3 w-full" onClick={() => toast(`Renewal reminder queued for ${r.holder_name}`, "info")}>
                    Queue renewal reminder
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Register a DSC" description="Track a client's digital signing certificate and its expiry.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Client">
            <select className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}>
              {clients.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="DSC holder name">
            <input required className="input" value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} placeholder="Rahul Sharma" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class">
              <select className="input" value={form.class_type} onChange={(e) => setForm({ ...form, class_type: e.target.value })}>
                {["Class 3 Signing", "Class 3 DGFT", "Class 3 Encryption", "DGFT"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Token serial">
              <input className="input" value={form.token_serial} onChange={(e) => setForm({ ...form, token_serial: e.target.value })} placeholder="TOK-48210" />
            </Field>
            <Field label="Valid from"><input type="date" className="input" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
            <Field label="Valid until"><input required type="date" className="input" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save DSC</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, icon, tone = "sage" }: { label: string; value: number; icon: React.ReactNode; tone?: "sage" | "gold" | "rose" }) {
  const tones = { sage: "bg-sage text-sage-ink", gold: "bg-gold-soft text-gold", rose: "bg-[#FBEAE7] text-[#A33B2E]" };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight text-ink">{value}</p>
      </div>
    </div>
  );
}
