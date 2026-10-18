"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCircle2, CreditCard, Download, Plus, Printer, ReceiptIndianRupee, Wallet, XCircle } from "lucide-react";
import type { Client, Invoice, Payment, Settings } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { compactInr, dayDiff, inr, prettyDate } from "@/lib/format";

const FILTERS = ["All", "Pending", "Partially Paid", "Overdue", "Paid"] as const;
type Filter = (typeof FILTERS)[number];

const PAYMENT_MODES: Payment["mode"][] = ["UPI", "Bank Transfer", "Cash", "Cheque", "Card", "Other"];

export function InvoicesView({ invoices, clients, settings }: { invoices: Invoice[]; clients: Client[]; settings: Settings }) {
  const [filter, setFilter] = React.useState<Filter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Invoice | null>(null);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [cancelConfirm, setCancelConfirm] = React.useState(false);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();

  const [form, setForm] = React.useState({
    client_id: clients[0]?.client_id ?? "",
    service_description: "",
    amount: 25000,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });

  const [paymentForm, setPaymentForm] = React.useState({
    amount: 0,
    paid_on: new Date().toISOString().slice(0, 10),
    mode: "Bank Transfer" as Payment["mode"],
    reference: "",
  });
  const [paying, setPaying] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return invoices.filter((i) => {
      const matchesFilter = filter === "All" || i.status === filter;
      const matchesQuery = !q || [i.invoice_id, i.client_name, i.service_description].join(" ").toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [invoices, filter, query]);

  const totalBilled = invoices.filter((i) => i.status !== "Cancelled").reduce((s, i) => s + i.total_amount, 0);
  const collected = invoices.filter((i) => i.status !== "Cancelled").reduce((s, i) => s + i.paid_amount, 0);
  const outstanding = totalBilled - collected;
  const overdue = invoices
    .filter((i) => i.status === "Overdue")
    .reduce((s, i) => s + (i.total_amount - i.paid_amount), 0);

  async function openInvoice(invoice: Invoice) {
    setSelected(invoice);
    setPayments([]);
    setCancelConfirm(false);
    setDetailLoading(true);
    setPaymentForm({
      amount: Math.max(0, invoice.total_amount - invoice.paid_amount),
      paid_on: new Date().toISOString().slice(0, 10),
      mode: "Bank Transfer",
      reference: "",
    });
    try {
      const res = await fetch(`/api/invoices/${invoice.invoice_id}`);
      if (!res.ok) throw new Error("Could not load the invoice");
      const data = (await res.json()) as { invoice: Invoice; payments: Payment[] };
      setSelected(data.invoice);
      setPayments(data.payments);
      setPaymentForm((f) => ({ ...f, amount: Math.max(0, data.invoice.total_amount - data.invoice.paid_amount) }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load the invoice", "error");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<Invoice>("/api/invoices", "POST", form, "Invoice created");
    if (created) {
      setAddOpen(false);
      setForm({ ...form, service_description: "", amount: 25000 });
    }
  }

  async function markPaid(inv: Invoice) {
    const updated = await mutate<Invoice>(`/api/invoices/${inv.invoice_id}`, "PATCH", { status: "Paid" }, `${inv.invoice_id} marked paid`);
    if (updated && selected?.invoice_id === inv.invoice_id) {
      setSelected(updated);
      const res = await fetch(`/api/invoices/${inv.invoice_id}`);
      if (res.ok) {
        const data = (await res.json()) as { invoice: Invoice; payments: Payment[] };
        setSelected(data.invoice);
        setPayments(data.payments);
      }
    }
  }

  async function cancelInvoice(inv: Invoice) {
    setCancelConfirm(false);
    const updated = await mutate<Invoice>(`/api/invoices/${inv.invoice_id}`, "PATCH", { status: "Cancelled" }, `${inv.invoice_id} cancelled`);
    if (updated) setSelected(updated);
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setPaying(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: selected.invoice_id,
          amount: paymentForm.amount,
          paid_on: paymentForm.paid_on,
          mode: paymentForm.mode,
          reference: paymentForm.reference,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { invoice?: Invoice; payment?: Payment; error?: string };
      if (!res.ok || !data.invoice) throw new Error(data.error || "Could not record the payment");
      setSelected(data.invoice);
      if (data.payment) setPayments((prev) => [data.payment!, ...prev]);
      toast(`${inr(paymentForm.amount)} received from ${selected.client_name}`);
      setPaymentForm({ ...paymentForm, amount: Math.max(0, data.invoice.total_amount - data.invoice.paid_amount), reference: "" });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not record the payment", "error");
    } finally {
      setPaying(false);
    }
  }

  const client = selected ? clients.find((c) => c.client_id === selected.client_id) : undefined;
  const balance = selected ? Math.max(0, selected.total_amount - selected.paid_amount) : 0;
  const cgst = selected ? Math.round((selected.gst_amount / 2) * 100) / 100 : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Fee recovery"
        title="Invoices & collections"
        description="Bill, record payments, print GST invoices and close the recovery gap."
      >
        <AiAssist task="collection_plan" label="Collection plan" />
        <a
          href="/api/export?type=invoices"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-subtle"
        >
          <Download className="h-4 w-4" /> Export CSV
        </a>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New invoice
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Money label="Billed" value={compactInr(totalBilled)} icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Money label="Collected" value={compactInr(collected)} icon={<Wallet className="h-4 w-4" />} />
        <Money label="Outstanding" value={compactInr(outstanding)} icon={<BellRing className="h-4 w-4" />} tone="gold" />
        <Money label="Overdue" value={compactInr(overdue)} icon={<span className="text-xs font-extrabold">!</span>} tone="rose" />
      </div>

      <SectionCard
        title={`${filtered.length} invoices`}
        subtitle="GST is applied at 18% (CGST 9% + SGST 9%) on new invoices"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs options={FILTERS.map((f) => ({ value: f, label: f }))} value={filter} onChange={setFilter} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search invoices…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<ReceiptIndianRupee className="h-5 w-5" />} title="No invoices in this view" description="Create an invoice or switch the filter." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[920px]">
              <thead>
                <tr className="bg-subtle/60">
                  <Th>Invoice</Th>
                  <Th>Client</Th>
                  <Th>Service</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const days = dayDiff(inv.due_date);
                  const invBalance = inv.total_amount - inv.paid_amount;
                  return (
                    <tr key={inv.invoice_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                      <Td>
                        <p className="font-mono text-[11px] font-semibold text-ink">{inv.invoice_id}</p>
                        <p className="text-[10px] text-muted">{prettyDate(inv.invoice_date)}</p>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={inv.client_name} className="h-7 w-7 text-[9px]" />
                          <span className="text-xs text-ink">{inv.client_name}</span>
                        </div>
                      </Td>
                      <Td><span className="text-[11px] text-muted">{inv.service_description}</span></Td>
                      <Td>
                        <p className="text-[11px] text-ink">{prettyDate(inv.due_date)}</p>
                        {inv.status !== "Paid" && inv.status !== "Cancelled" ? (
                          <p className={`text-[10px] ${days < 0 ? "text-[#A33B2E]" : "text-muted"}`}>
                            {days < 0 ? `${Math.abs(days)} days late` : `in ${days} days`}
                          </p>
                        ) : <p className="text-[10px] text-muted">Paid {prettyDate(inv.paid_date)}</p>}
                      </Td>
                      <Td className="text-right">
                        <p className="text-xs font-extrabold text-ink">{inr(inv.total_amount)}</p>
                        <p className="text-[10px] text-muted">{inr(inv.amount)} + GST</p>
                        {inv.paid_amount > 0 && inv.status !== "Paid" ? (
                          <p className="text-[10px] font-semibold text-[#8A6420]">{inr(invBalance)} due</p>
                        ) : null}
                      </Td>
                      <Td><StatusPill status={inv.status} /></Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => openInvoice(inv)}>View</Button>
                          {inv.status !== "Paid" && inv.status !== "Cancelled" ? (
                            <Button size="sm" variant="soft" onClick={() => markPaid(inv)} loading={busy}>Mark paid</Button>
                          ) : null}
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Create an invoice" description="A GST line of 18% (CGST 9% + SGST 9%) is added automatically.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Client">
            <select required className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Service description">
            <input required className="input" value={form.service_description} onChange={(e) => setForm({ ...form, service_description: e.target.value })} placeholder="GST retainer — Oct 2026" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice date"><input type="date" className="input" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          </div>
          <Field label="Amount (before GST)">
            <input required type="number" min={1} className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
          </Field>
          <div className="flex items-center justify-between rounded-2xl bg-sage px-4 py-3 text-xs">
            <span className="font-semibold text-sage-ink">Total incl. 18% GST</span>
            <span className="text-sm font-extrabold text-sage-ink">{inr(form.amount * 1.18)}</span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create invoice</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? selected.invoice_id : "Invoice"}
        description={selected ? `${selected.client_name} · ${prettyDate(selected.invoice_date)}` : undefined}
        wide
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusPill status={selected.status} />
              <div className="flex flex-wrap gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
                <ReminderButton
                  recipient={selected.client_name}
                  phone={client?.phone}
                  email={client?.email}
                  subject={`Invoice ${selected.invoice_id} — ${selected.service_description}`}
                  relatedType="invoice"
                  relatedId={selected.invoice_id}
                  label="Remind"
                  variant="secondary"
                  message={`Dear ${client?.contact_person || selected.client_name},\n\nA gentle reminder from ${settings.firm_name ?? "our firm"}: invoice ${selected.invoice_id} for ${selected.service_description} has an outstanding balance of ${inr(balance)} (due ${prettyDate(selected.due_date)}).\n\nKindly arrange the payment at your earliest convenience.\n\nRegards,\n${settings.firm_name ?? ""}`}
                />
                {selected.status !== "Paid" && selected.status !== "Cancelled" ? (
                  <Button size="sm" onClick={() => markPaid(selected)} loading={busy}>Mark fully paid</Button>
                ) : null}
                {selected.status !== "Cancelled" ? (
                  cancelConfirm ? (
                    <Button variant="danger" size="sm" onClick={() => cancelInvoice(selected)} loading={busy}>Confirm cancel</Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setCancelConfirm(true)}>
                      <XCircle className="h-3.5 w-3.5" /> Cancel invoice
                    </Button>
                  )
                ) : null}
              </div>
            </div>

            <div className="print-sheet max-h-[52vh] overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 text-ink">
              <div className="flex items-start justify-between gap-4 border-b border-black/10 pb-4">
                <div>
                  <p className="text-base font-extrabold">{settings.firm_name ?? "CA Firm"}</p>
                  <p className="text-[11px] text-muted">{settings.firm_tagline ?? "Chartered Accountants"}</p>
                  <p className="mt-1 max-w-[300px] text-[10px] leading-relaxed text-muted">{settings.firm_address ?? ""}</p>
                  <p className="text-[10px] text-muted">{settings.firm_phone ?? ""} · {settings.firm_email ?? ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold uppercase tracking-[0.12em]">Tax Invoice</p>
                  <p className="mt-1 font-mono text-[11px] font-semibold">{selected.invoice_id}</p>
                  <p className="text-[10px] text-muted">Date: {prettyDate(selected.invoice_date)}</p>
                  <p className="text-[10px] text-muted">Due: {prettyDate(selected.due_date)}</p>
                  {settings.firm_gstin ? <p className="mt-1 text-[10px] text-muted">GSTIN: {settings.firm_gstin}</p> : null}
                </div>
              </div>

              <div className="grid gap-4 py-4 text-[11px] sm:grid-cols-2">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Billed to</p>
                  <p className="mt-1 font-semibold">{selected.client_name}</p>
                  {client?.contact_person ? <p className="text-muted">{client.contact_person}</p> : null}
                  {client?.city ? <p className="text-muted">{client.city}, {client.state}</p> : null}
                  {client?.gst_number ? <p className="text-muted">GSTIN: {client.gst_number}</p> : null}
                  {client?.pan ? <p className="text-muted">PAN: {client.pan}</p> : null}
                </div>
                <div className="sm:text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Supply details</p>
                  <p className="mt-1 text-muted">Place of supply: {client?.state || "—"}</p>
                  <p className="text-muted">SAC: 998221 · Professional services</p>
                  <p className="text-muted">Reverse charge: No</p>
                </div>
              </div>

              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-y border-black/10 text-left text-[9px] uppercase tracking-[0.1em] text-muted">
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">SAC</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-black/5">
                    <td className="py-2">{selected.service_description}</td>
                    <td className="py-2 text-right">998221</td>
                    <td className="py-2 text-right">{inr(selected.amount)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="ml-auto mt-3 w-full max-w-[260px] space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-muted">Taxable value</span><span>{inr(selected.amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted">CGST 9%</span><span>{inr(cgst)}</span></div>
                <div className="flex justify-between"><span className="text-muted">SGST 9%</span><span>{inr(selected.gst_amount - cgst)}</span></div>
                <div className="flex justify-between border-t border-black/10 pt-1 font-extrabold"><span>Total</span><span>{inr(selected.total_amount)}</span></div>
                <div className="flex justify-between text-muted"><span>Paid</span><span>{inr(selected.paid_amount)}</span></div>
                {balance > 0 ? <div className="flex justify-between font-bold text-[#A33B2E]"><span>Balance due</span><span>{inr(balance)}</span></div> : null}
              </div>

              <div className="mt-5 flex items-end justify-between border-t border-black/10 pt-3 text-[10px] text-muted">
                <p className="max-w-[340px] leading-relaxed">
                  Payment by UPI or bank transfer. This is a computer-generated invoice; GST is charged as applicable on professional services.
                </p>
                <div className="text-right">
                  <p className="font-semibold text-ink">For {settings.firm_name ?? "the firm"}</p>
                  <p className="mt-6">Authorised signatory</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Payment history</p>
                {detailLoading ? <p className="py-4 text-center text-[11px] text-muted">Loading…</p> : null}
                {!detailLoading && payments.length === 0 ? (
                  <p className="py-3 text-[11px] text-muted">No payments recorded yet.</p>
                ) : null}
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.payment_id} className="flex items-center justify-between gap-2 border-b border-black/5 pb-2 last:border-0 last:pb-0">
                      <div>
                        <p className="text-xs font-semibold text-ink">{inr(p.amount)} · {p.mode}</p>
                        <p className="text-[10px] text-muted">{prettyDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}</p>
                      </div>
                      <Badge tone="green">Received</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-subtle p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Record a payment</p>
                {balance <= 0 ? (
                  <p className="py-3 text-[11px] text-muted">This invoice is fully settled.</p>
                ) : (
                  <form onSubmit={recordPayment} className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Amount">
                        <input
                          required
                          type="number"
                          min={1}
                          max={balance}
                          step="0.01"
                          className="input"
                          value={paymentForm.amount}
                          onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="Date">
                        <input type="date" className="input" value={paymentForm.paid_on} onChange={(e) => setPaymentForm({ ...paymentForm, paid_on: e.target.value })} />
                      </Field>
                      <Field label="Mode">
                        <select className="input" value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value as Payment["mode"] })}>
                          {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </Field>
                      <Field label="Reference">
                        <input className="input" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="UTR / cheque no." />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-muted">Balance {inr(balance)}</p>
                      <Button type="submit" size="sm" loading={paying}>
                        <CreditCard className="h-3.5 w-3.5" /> Record payment
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {selected.status === "Paid" ? (
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-green">
                <CheckCircle2 className="h-3.5 w-3.5" /> Settled {prettyDate(selected.paid_date)} · {inr(selected.paid_amount)} received
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Money({ label, value, icon, tone = "sage" }: { label: string; value: string; icon: React.ReactNode; tone?: "sage" | "gold" | "rose" }) {
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
