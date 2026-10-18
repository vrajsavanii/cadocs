"use client";

import * as React from "react";
import { CheckCheck, Copy, FileSignature, Plus, Printer, Send } from "lucide-react";
import type { Lead, Proposal } from "@/lib/types";
import { Badge, Button, EmptyState, Field, PageHeader, Stat, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { SearchBox, SectionCard, useMutation } from "./shared";
import { prettyDate } from "@/lib/format";

const ENTITY_TYPES = ["Private Limited", "LLP", "Proprietorship", "Partnership", "Trust", "HUF", "Individual", "Other"];
const FEE_PRESETS = ["₹15,000 / month", "₹18,000 / month", "₹25,000 / month", "₹45,000 / engagement", "₹75,000 / engagement"];

const emptyForm = {
  lead_id: "",
  entity_type: "Private Limited",
  services: "",
  fee: FEE_PRESETS[0],
};

export function ProposalsView({ proposals, leads }: { proposals: Proposal[]; leads: Lead[] }) {
  const [query, setQuery] = React.useState("");
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<Proposal | null>(null);
  const [form, setForm] = React.useState(emptyForm);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return proposals;
    return proposals.filter((p) =>
      [p.proposal_id, p.prospect_name, p.company_name, p.services, p.fee, p.status].join(" ").toLowerCase().includes(q),
    );
  }, [proposals, query]);

  const stats = React.useMemo(() => {
    const accepted = proposals.filter((p) => p.status === "Accepted").length;
    const sent = proposals.filter((p) => p.status === "Sent" || p.status === "Accepted").length;
    return {
      total: proposals.length,
      sent,
      accepted,
      rate: sent ? Math.round((accepted / sent) * 100) : 0,
    };
  }, [proposals]);

  const selectedLead = leads.find((l) => l.lead_id === form.lead_id);

  function openCompose() {
    setForm(emptyForm);
    setComposeOpen(true);
  }

  function chooseLead(leadId: string) {
    const lead = leads.find((l) => l.lead_id === leadId);
    setForm((f) => ({
      ...f,
      lead_id: leadId,
      services: lead?.service_interest || f.services,
      entity_type: lead?.company_name?.includes("LLP") ? "LLP" : f.entity_type,
    }));
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Proposal>("/api/proposals", "POST", form, "Proposal drafted");
    if (created) {
      setComposeOpen(false);
      setPreview(created);
    }
  }

  async function setStatus(proposal: Proposal, status: Proposal["status"]) {
    const updated = await mutate<Proposal>(`/api/proposals/${proposal.proposal_id}`, "PATCH", { status }, `Marked ${status.toLowerCase()}`);
    if (updated) setPreview(updated);
  }

  async function convert(proposal: Proposal) {
    const result = await mutate<{ proposal: Proposal; client: { client_id: string; name: string }; created: boolean }>(
      `/api/proposals/${proposal.proposal_id}/convert`,
      "POST",
      undefined,
      "Engagement converted into a client",
    );
    if (result) setPreview(result.proposal);
  }

  async function copy() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.body);
      toast("Proposal copied to clipboard");
    } catch {
      toast("Clipboard is blocked in this browser", "error");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="New business"
        title="Proposals"
        description="Draft partner-ready engagement proposals from the lead pipeline in one pass."
      >
        <Button onClick={openCompose}>
          <Plus className="h-4 w-4" /> New proposal
        </Button>
      </PageHeader>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Proposals" value={stats.total} hint="All drafts and sent documents" icon={<FileSignature className="h-4 w-4" />} />
        <Stat label="Sent to prospects" value={stats.sent} hint="Awaiting a decision" icon={<Send className="h-4 w-4" />} tone="blue" />
        <Stat label="Accepted" value={stats.accepted} hint="Converted into engagements" icon={<CheckCheck className="h-4 w-4" />} tone="sage" />
        <Stat label="Conversion" value={`${stats.rate}%`} hint="Accepted ÷ sent proposals" icon={<CheckCheck className="h-4 w-4" />} tone="gold" />
      </div>

      <SectionCard
        title={`${filtered.length} of ${proposals.length} proposals`}
        subtitle="Generated from live lead + firm settings — fully editable before sending"
        action={<SearchBox value={query} onChange={setQuery} placeholder="Search proposals…" className="w-full sm:w-56" />}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="h-5 w-5" />}
            title={proposals.length ? "No proposals match that search" : "No proposals yet"}
            description={proposals.length ? "Try a different prospect, company or fee." : "Generate your first engagement proposal from a qualified lead."}
            action={<Button onClick={openCompose}><Plus className="h-4 w-4" /> New proposal</Button>}
          />
        ) : (
          <TableShell>
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Reference</Th>
                  <Th>Prospect</Th>
                  <Th>Services</Th>
                  <Th>Fee</Th>
                  <Th>Created</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.proposal_id} className="border-t border-black/5 transition hover:bg-subtle/50">
                    <Td>
                      <p className="font-mono text-[11px] font-semibold text-ink">{p.proposal_id}</p>
                      <p className="text-[10px] text-muted">{p.lead_id}</p>
                    </Td>
                    <Td>
                      <p className="text-sm font-semibold text-ink">{p.prospect_name}</p>
                      <p className="text-[11px] text-muted">{p.company_name} · {p.entity_type}</p>
                    </Td>
                    <Td>
                      <div className="flex max-w-[240px] flex-wrap gap-1">
                        {p.services.split(",").slice(0, 2).map((s) => (
                          <Badge key={s} tone="sage">{s.trim()}</Badge>
                        ))}
                        {p.services.split(",").length > 2 ? <Badge tone="neutral">+{p.services.split(",").length - 2}</Badge> : null}
                      </div>
                    </Td>
                    <Td><span className="text-xs font-semibold text-ink">{p.fee}</span></Td>
                    <Td><span className="text-[11px] text-muted">{prettyDate(p.created_at)}</span></Td>
                    <Td><StatusPill status={p.status} /></Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => setPreview(p)}>View</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="Generate a proposal"
        description="Pick a lead, confirm the scope and fee — the document is built from your firm settings."
        wide
      >
        <form onSubmit={generate} className="space-y-3">
          <Field label="Lead" hint="Prospect details are pulled from the CRM record.">
            <select required className="input" value={form.lead_id} onChange={(e) => chooseLead(e.target.value)}>
              <option value="">Select a lead…</option>
              {leads.map((l) => (
                <option key={l.lead_id} value={l.lead_id}>
                  {l.name} — {l.company_name || l.name} ({l.status})
                </option>
              ))}
            </select>
          </Field>

          {selectedLead ? (
            <div className="grid gap-2 rounded-2xl bg-subtle p-3 text-[11px] text-muted sm:grid-cols-3">
              <p><span className="font-bold text-ink">Score</span> · {selectedLead.lead_score}</p>
              <p><span className="font-bold text-ink">Category</span> · {selectedLead.category}</p>
              <p><span className="font-bold text-ink">Stage</span> · {selectedLead.status}</p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entity type">
              <select className="input" value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
                {ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Proposed fee">
              <input className="input" list="fee-presets" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
              <datalist id="fee-presets">
                {FEE_PRESETS.map((f) => <option key={f} value={f} />)}
              </datalist>
            </Field>
            <Field label="Scope of services" className="sm:col-span-2" hint="Comma-separated — each item becomes a scope line.">
              <input required className="input" value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} placeholder="GST Filing, Tax Audit, ITR" />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!form.lead_id}>Generate proposal</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `${preview.company_name} — ${preview.proposal_id}` : "Proposal"}
        description={preview ? `${preview.prospect_name} · ${preview.fee} · ${prettyDate(preview.created_at)}` : undefined}
        wide
      >
        {preview ? (
          <div className="space-y-4">
            <div className="print-sheet max-h-[58vh] overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 text-[12.5px] leading-relaxed text-ink">
              <pre className="whitespace-pre-wrap font-sans">{preview.body}</pre>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={preview.status} />
                {preview.converted_client_id ? <Badge tone="sage">Client {preview.converted_client_id}</Badge> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={copy}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
                <Button variant="secondary" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
                {preview.status === "Draft" ? (
                  <Button size="sm" onClick={() => setStatus(preview, "Sent")} loading={busy}>
                    <Send className="h-3.5 w-3.5" /> Mark sent
                  </Button>
                ) : null}
                {preview.status === "Sent" ? (
                  <>
                    <Button size="sm" onClick={() => setStatus(preview, "Accepted")} loading={busy}>
                      <CheckCheck className="h-3.5 w-3.5" /> Accepted
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setStatus(preview, "Declined")} loading={busy}>
                      Declined
                    </Button>
                  </>
                ) : null}
                {preview.status === "Accepted" && !preview.converted_client_id ? (
                  <Button size="sm" onClick={() => convert(preview)} loading={busy}>
                    <Plus className="h-3.5 w-3.5" /> Convert to client
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
