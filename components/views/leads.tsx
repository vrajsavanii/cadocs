"use client";

import * as React from "react";
import { ArrowRight, Phone, Plus, Target, Trophy } from "lucide-react";
import type { Lead } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, SearchBox, useMutation } from "./shared";
import { cn } from "../ui";

const STAGES: Lead["status"][] = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];
const STAGE_TONE: Record<string, string> = {
  New: "bg-[#F3F1EC]",
  Contacted: "bg-[#EEF3F9]",
  Qualified: "bg-[#F3EFF9]",
  "Proposal Sent": "bg-[#FBF3E4]",
  Won: "bg-[#EAF3EC]",
  Lost: "bg-[#F8ECEA]",
};

const emptyForm = {
  name: "",
  company_name: "",
  phone: "",
  email: "",
  source: "Website",
  service_interest: "GST Filing, ITR",
  lead_score: 60,
  category: "Warm" as Lead["category"],
  notes: "",
};

export function LeadsView({ leads }: { leads: Lead[] }) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("All");
  const [addOpen, setAddOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Lead | null>(null);
  const [noteDraft, setNoteDraft] = React.useState("");
  const [form, setForm] = React.useState(emptyForm);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return leads.filter((l) => {
      const matchesCategory = category === "All" || l.category === category;
      const matchesQuery = !q || [l.name, l.company_name, l.phone, l.email, l.service_interest, l.notes].join(" ").toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [leads, category, query]);

  const open = leads.filter((l) => !["Won", "Lost"].includes(l.status));
  const hot = open.filter((l) => l.category === "Hot").length;
  const won = leads.filter((l) => l.status === "Won").length;

  const nextStage = (status: Lead["status"]): Lead["status"] | null => {
    const idx = STAGES.indexOf(status);
    if (idx < 0 || idx >= 3) return null;
    return STAGES[idx + 1];
  };

  async function advance(lead: Lead) {
    const next = nextStage(lead.status);
    if (!next) return;
    await mutate<Lead>(`/api/leads/${lead.lead_id}`, "PATCH", { status: next }, `${lead.name} moved to ${next}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Lead>("/api/leads", "POST", form, `${form.name} added to pipeline`);
    if (created) {
      setAddOpen(false);
      setForm(emptyForm);
    }
  }

  async function saveNotes() {
    if (!selected) return;
    const updated = await mutate<Lead>(`/api/leads/${selected.lead_id}`, "PATCH", { status: selected.status, notes: noteDraft }, "Lead notes updated");
    if (updated) setSelected({ ...selected, notes: noteDraft });
  }

  return (
    <div>
      <PageHeader
        eyebrow="Business development"
        title="Lead qualification pipeline"
        description="Score, qualify and convert enquiries into signed engagements."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add lead
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Open leads" value={open.length} icon={<Target className="h-4 w-4" />} />
        <MiniStat label="Hot leads" value={hot} icon={<span className="text-sm">🔥</span>} tone="rose" />
        <MiniStat label="Qualified" value={leads.filter((l) => l.status === "Qualified" || l.status === "Proposal Sent").length} icon={<ArrowRight className="h-4 w-4" />} tone="gold" />
        <MiniStat label="Won" value={won} icon={<Trophy className="h-4 w-4" />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <FilterTabs
          options={[
            { value: "All", label: "All", count: leads.length },
            { value: "Hot", label: "Hot", count: leads.filter((l) => l.category === "Hot").length },
            { value: "Warm", label: "Warm", count: leads.filter((l) => l.category === "Warm").length },
            { value: "Cold", label: "Cold", count: leads.filter((l) => l.category === "Cold").length },
          ]}
          value={category}
          onChange={setCategory}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="Search leads…" className="w-full sm:w-64" />
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Target className="h-5 w-5" />} title="No leads match" description="Adjust the search or category filter." />
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-3">
          {STAGES.map((stage) => {
            const items = filtered.filter((l) => l.status === stage);
            return (
              <div key={stage} className={cn("w-[260px] shrink-0 rounded-[22px] p-2.5", STAGE_TONE[stage])}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink/70">{stage}</p>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-muted">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((lead) => (
                    <button
                      key={lead.lead_id}
                      onClick={() => { setSelected(lead); setNoteDraft(lead.notes); }}
                      className="w-full rounded-2xl bg-white p-3 text-left shadow-[0_2px_10px_-6px_rgba(25,32,28,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-12px_rgba(25,32,28,0.4)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-extrabold text-ink">{lead.name}</p>
                          <p className="truncate text-[10px] text-muted">{lead.company_name || "Individual"}</p>
                        </div>
                        <Badge tone={lead.category === "Hot" ? "red" : lead.category === "Warm" ? "amber" : "blue"}>{lead.lead_score}</Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted">{lead.service_interest}</p>
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] text-muted"><Phone className="h-3 w-3" />{lead.phone}</span>
                        {nextStage(lead.status) ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); void advance(lead); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void advance(lead); } }}
                            className="inline-flex items-center gap-0.5 rounded-full bg-sage px-2 py-1 text-[9px] font-bold text-sage-ink transition hover:bg-[#dbe8dd]"
                          >
                            Advance <ArrowRight className="h-2.5 w-2.5" />
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-muted">{lead.status === "Won" ? "Converted" : "Closed"}</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {items.length === 0 ? <p className="px-1 py-4 text-center text-[10px] text-muted/80">No leads</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a lead" description="Capture the enquiry and score it for follow-up priority.">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lead name"><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aditya Rao" /></Field>
            <Field label="Firm / company"><input className="input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Rao Foods Pvt Ltd" /></Field>
            <Field label="Phone"><input required className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9820112233" /></Field>
            <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Source">
              <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {["Website", "Referral", "WhatsApp", "LinkedIn", "Event", "Walk-in"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Score (0–100)">
              <input type="number" min={0} max={100} className="input" value={form.lead_score} onChange={(e) => setForm({ ...form, lead_score: Number(e.target.value) })} />
            </Field>
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Lead["category"] })}>
                {["Hot", "Warm", "Cold"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Service interest"><input className="input" value={form.service_interest} onChange={(e) => setForm({ ...form, service_interest: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2">
              <textarea className="input min-h-[72px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Turnover, urgency, scope…" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Add lead</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.name ?? "Lead"} description={selected ? `${selected.company_name || "Individual"} · ${selected.source}` : undefined}>
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} className="h-11 w-11" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-ink">{selected.name}</p>
                <p className="text-[11px] text-muted">{selected.phone} · {selected.email || "no email"}</p>
              </div>
              <StatusPill status={selected.status} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-subtle p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Lead score</p>
                <p className="mt-1 text-lg font-extrabold text-ink">{selected.lead_score}</p>
              </div>
              <div className="rounded-2xl bg-subtle p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Category</p>
                <p className="mt-1 text-lg font-extrabold text-ink">{selected.category}</p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Service interest</p>
              <p className="text-xs text-ink">{selected.service_interest}</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Notes</p>
              <textarea className="input min-h-[80px]" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {(["Hot", "Warm", "Cold"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={async () => {
                      const updated = await mutate<Lead>(`/api/leads/${selected.lead_id}`, "PATCH", { status: selected.status, category: c }, `Marked ${c}`);
                      if (updated) setSelected({ ...selected, category: c });
                    }}
                    className={cn("rounded-full px-3 py-1.5 text-[10px] font-bold", selected.category === c ? "bg-green text-white" : "bg-black/5 text-muted hover:text-ink")}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => { if (!selected.phone) return toast("No phone number", "error"); window.open(`https://wa.me/91${selected.phone}`, "_blank"); }}>
                  <Phone className="h-3.5 w-3.5" /> WhatsApp
                </Button>
                <Button size="sm" onClick={saveNotes} loading={busy}>Save</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-black/5 pt-3">
              {STAGES.map((s) => (
                <button
                  key={s}
                  onClick={async () => {
                    const updated = await mutate<Lead>(`/api/leads/${selected.lead_id}`, "PATCH", { status: s }, `Moved to ${s}`);
                    if (updated) setSelected({ ...selected, status: s });
                  }}
                  className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", selected.status === s ? "bg-green text-white" : "bg-black/[0.04] text-muted hover:text-ink")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function MiniStat({ label, value, icon, tone = "sage" }: { label: string; value: number; icon: React.ReactNode; tone?: "sage" | "gold" | "rose" }) {
  const tones = { sage: "bg-sage text-sage-ink", gold: "bg-gold-soft text-gold", rose: "bg-[#FBEAE7] text-[#A33B2E]" };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tones[tone])}>{icon}</span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-lg font-extrabold leading-tight text-ink">{value}</p>
      </div>
    </div>
  );
}
