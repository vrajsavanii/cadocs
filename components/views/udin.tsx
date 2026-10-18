"use client";

import * as React from "react";
import { BadgeCheck, Copy, Plus, Trash2 } from "lucide-react";
import type { Udin } from "@/lib/types";
import { Badge, Button, EmptyState, Field, PageHeader, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { SearchBox, SectionCard, useMutation } from "./shared";
import { prettyDate } from "@/lib/format";

export function UdinView({ records, clients }: { records: Udin[]; clients: string[] }) {
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    udin: "",
    client_name: clients[0] ?? "",
    document_type: "Audited Financial Statements",
    financial_year: "FY 2025-26",
    generated_date: new Date().toISOString().slice(0, 10),
    ca_member_no: "154789",
    notes: "",
  });

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return records;
    return records.filter((r) => [r.udin, r.client_name, r.document_type, r.financial_year].join(" ").toLowerCase().includes(q));
  }, [records, query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Udin>("/api/udin", "POST", form, "UDIN recorded");
    if (created) {
      setAddOpen(false);
      setForm({ ...form, udin: "", notes: "" });
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("UDIN copied to clipboard");
    } catch {
      toast("Could not access clipboard", "error");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="ICAI compliance"
        title="UDIN register"
        description="Every unique document identification number issued by the firm, in one audit-ready ledger."
      >
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Record UDIN
        </Button>
      </PageHeader>

      <SectionCard
        title={`${filtered.length} records`}
        subtitle="Retain for the statutory record period — search by UDIN, client or document type"
        action={<SearchBox value={query} onChange={setQuery} placeholder="Search register…" className="w-full sm:w-64" />}
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="h-5 w-5" />} title="No UDIN records" description="Generate a UDIN for any signed certificate or audit report." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>UDIN</Th>
                  <Th>Client</Th>
                  <Th>Document type</Th>
                  <Th>Financial year</Th>
                  <Th>Generated</Th>
                  <Th>Member no.</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.udin_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                    <Td>
                      <span className="font-mono text-[11px] font-bold text-ink">{r.udin}</span>
                    </Td>
                    <Td><span className="text-xs text-ink">{r.client_name}</span></Td>
                    <Td><Badge tone="sage">{r.document_type}</Badge></Td>
                    <Td><span className="text-[11px] text-muted">{r.financial_year}</span></Td>
                    <Td><span className="text-[11px] text-muted">{prettyDate(r.generated_date)}</span></Td>
                    <Td><span className="font-mono text-[11px] text-muted">{r.ca_member_no}</span></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => copy(r.udin)} aria-label="Copy UDIN"><Copy className="h-3.5 w-3.5" /></Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[#A33B2E]"
                          aria-label="Delete UDIN"
                          onClick={async () => {
                            const res = await mutate(`/api/udin/${r.udin_id}`, "DELETE", undefined, "UDIN record deleted");
                            if (res) toast("Register updated");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </SectionCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)}        title="Record UDIN"
        description="Generate the UDIN on the ICAI portal, then record the exact number against the signed document."
      >
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UDIN (from ICAI portal)" className="sm:col-span-2" hint="The 18-character number issued by udin.icai.org — stored verbatim, duplicates rejected.">
              <input
                required
                className="input font-mono uppercase"
                value={form.udin}
                onChange={(e) => setForm({ ...form, udin: e.target.value.toUpperCase().replace(/\s+/g, "") })}
                placeholder="24123456ABCDEFGH12"
                minLength={10}
                maxLength={24}
                pattern="[A-Za-z0-9]{10,24}"
              />
            </Field>
            <Field label="Client" className="sm:col-span-2">
              <select className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}>
                {clients.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Document type" className="sm:col-span-2">
              <select className="input" value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })}>
                {[
                  "Audited Financial Statements", "Tax Audit Report (3CA/3CB)", "Statutory Audit Report",
                  "Trust Audit Certificate", "Certification — Net Worth", "GST Annual Return Certification",
                  "Form 15CB Certification",
                ].map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Financial year"><input className="input" value={form.financial_year} onChange={(e) => setForm({ ...form, financial_year: e.target.value })} /></Field>
            <Field label="Generated date"><input type="date" className="input" value={form.generated_date} onChange={(e) => setForm({ ...form, generated_date: e.target.value })} /></Field>
            <Field label="CA membership no."><input className="input" value={form.ca_member_no} onChange={(e) => setForm({ ...form, ca_member_no: e.target.value })} /></Field>
            <Field label="Notes"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Record UDIN</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
