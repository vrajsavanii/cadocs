"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, Ban, CheckCircle2, Clock3, CreditCard, Download, FileText, MessageCircle, Plus, Printer, ReceiptIndianRupee, Send, Wallet, XCircle } from "lucide-react";
import type { Client, Invoice, InvoiceLine, Payment, Settings } from "@/lib/types";
import { Avatar, Badge, Button, EmptyState, Field, PageHeader, StatusPill, TableShell, Td, Th } from "../ui";
import { Modal, useToast } from "../interactive";
import { FilterTabs, ReminderButton, SearchBox, SectionCard, useMutation } from "./shared";
import { AiAssist } from "../ai-assist";
import { compactInr, dayDiff, inr, prettyDate } from "@/lib/format";

const LIFECYCLE_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  issued: "Issued",
  cancelled: "Cancelled",
};

type LifecycleFilter = "All" | "Draft" | "Pending approval" | "Approved" | "Issued" | "Cancelled" | "Partially Paid" | "Paid" | "Overdue";
const FILTERS: LifecycleFilter[] = ["All", "Draft", "Pending approval", "Approved", "Issued", "Partially Paid", "Overdue", "Paid", "Cancelled"];

const PAYMENT_MODES: Payment["mode"][] = ["UPI", "Bank Transfer", "Cash", "Cheque", "Card", "Other"];

type InvoiceDetail = {
  invoice: Invoice;
  lines: InvoiceLine[];
  payments: Payment[];
  creditNotes: Array<{ credit_note_id: string; number: string; total_paise: number; reason: string }>;
  events: Array<{ event_id: string; event: string; actor: string; role: string; detail: string; created_at: string }>;
  computed: { totalPaise: number; paidPaise: number; creditPaise: number; balancePaise: number };
};

export function InvoicesView({ invoices, clients, settings }: { invoices: Invoice[]; clients: Client[]; settings: Settings }) {
  const [filter, setFilter] = React.useState<LifecycleFilter>("All");
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Invoice | null>(null);
  const [detail, setDetail] = React.useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [cancelConfirm, setCancelConfirm] = React.useState<null | "void" | "cancel" | "reject" | "credit-note" | "credit-amount">(null);
  const [actionReason, setActionReason] = React.useState("");
  const [creditAmount, setCreditAmount] = React.useState(0);
  const [receivables, setReceivables] = React.useState<{ aging: Array<{ label: string; invoiceCount: number; outstandingPaise: number }>; totals: { outstandingPaise: number; overduePaise: number } } | null>(null);
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const router = useRouter();

  const [form, setForm] = React.useState({
    client_id: clients[0]?.client_id ?? "",
    description: "",
    quantity: 1,
    unit_price: 25000,
    treatment_id: "TAX-NONE",
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    notes: "",
  });

  const [paymentForm, setPaymentForm] = React.useState({
    amount: 0,
    paid_on: new Date().toISOString().slice(0, 10),
    mode: "Bank Transfer" as Payment["mode"],
    reference: "",
  });
  const [paying, setPaying] = React.useState(false);

  function matchesFilter(inv: Invoice, f: LifecycleFilter): boolean {
    if (f === "All") return true;
    const lc = inv.lifecycle || "draft";
    if (f === "Draft") return lc === "draft";
    if (f === "Pending approval") return lc === "pending_approval";
    if (f === "Approved") return lc === "approved";
    if (f === "Issued") return lc === "issued" && inv.status !== "Partially Paid" && inv.status !== "Paid" && inv.status !== "Overdue";
    if (f === "Cancelled") return lc === "cancelled";
    return inv.status === f;
  }

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return invoices.filter((i) => {
      const matchesQuery = !q || [i.invoice_id, i.invoice_number || "", i.client_name, i.service_description].join(" ").toLowerCase().includes(q);
      return matchesQuery && matchesFilter(i, filter);
    });
  }, [invoices, filter, query]);

  function totalsFor(list: Invoice[]) {
    const live = list.filter((i) => (i.lifecycle || "draft") !== "cancelled" && (i.lifecycle || "draft") !== "draft");
    const billed = live.reduce((s, i) => s + (i.total_paise ?? Math.round(i.total_amount * 100)), 0);
    const collectedPaise = live.reduce((s, i) => s + (i.paid_paise ?? Math.round(i.paid_amount * 100)), 0);
    const creditedPaise = live.reduce((s, i) => s + (i.credit_paise ?? 0), 0);
    const outstandingPaise = billed - collectedPaise - creditedPaise;
    const overduePaise = live
      .filter((i) => i.status === "Overdue")
      .reduce((s, i) => s + (i.total_paise ?? Math.round(i.total_amount * 100)) - (i.paid_paise ?? Math.round(i.paid_amount * 100)) - (i.credit_paise ?? 0), 0);
    return { billed, collectedPaise, outstandingPaise, overduePaise };
  }
  const totals = totalsFor(invoices);

  async function loadReceivables() {
    try {
      const res = await fetch("/api/billing/receivables");
      if (!res.ok) throw new Error("Could not load receivables");
      const data = await res.json();
      setReceivables({ aging: data.aging ?? [], totals: data.totals ?? { outstandingPaise: 0, overduePaise: 0 } });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load receivables", "error");
    }
  }

  React.useEffect(() => {
    void loadReceivables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openInvoice(invoice: Invoice) {
    setSelected(invoice);
    setDetail(null);
    setCancelConfirm(null);
    setDetailLoading(true);
    setPaymentForm({
      amount: Math.max(0, Math.round(((invoice.total_paise ?? Math.round(invoice.total_amount * 100)) - (invoice.paid_paise ?? Math.round(invoice.paid_amount * 100)) - (invoice.credit_paise ?? 0)) / 100)),
      paid_on: new Date().toISOString().slice(0, 10),
      mode: "Bank Transfer",
      reference: "",
    });
    try {
      const res = await fetch(`/api/invoices/${invoice.invoice_id}`);
      if (!res.ok) throw new Error("Could not load the invoice");
      const data = (await res.json()) as InvoiceDetail;
      setSelected(data.invoice);
      setDetail(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load the invoice", "error");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelected(invoiceId: string) {
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (res.ok) {
      const data = (await res.json()) as InvoiceDetail;
      setSelected(data.invoice);
      setDetail(data);
      router.refresh();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const created = await mutate<{ invoice: Invoice }>("/api/invoices", "POST", {
      client_id: form.client_id,
      lines: [{ description: form.description, quantity: form.quantity, unit_price: form.unit_price, treatment_id: form.treatment_id }],
      invoice_date: form.invoice_date,
      due_date: form.due_date || undefined,
      notes: form.notes || undefined,
    }, "Draft invoice created — it becomes a receivable when issued");
    if (created) {
      setAddOpen(false);
      setForm({ ...form, description: "", unit_price: 25000, notes: "" });
      router.refresh();
    }
  }

  async function lifecycle(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return;
    const res = await fetch(`/api/invoices/${selected.invoice_id}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast(data.error || "The action was refused", "error");
      return;
    }
    toast(ACTION_LABEL[action] ?? `Action ${action} recorded`);
    setCancelConfirm(null);
    setActionReason("");
    await refreshSelected(selected.invoice_id);
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
      const data = (await res.json().catch(() => ({}))) as { payment?: Payment; error?: string };
      if (!res.ok || !data.payment) throw new Error(data.error || "Could not record the payment");
      toast(data.payment.status === "Pending reconciliation"
        ? `${inr(paymentForm.amount)} recorded — pending reconciliation until confirmed`
        : `${inr(paymentForm.amount)} recorded against the ledger`, "success");
      setPaymentForm({ ...paymentForm, amount: 0, reference: "" });
      await refreshSelected(selected.invoice_id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not record the payment", "error");
    } finally {
      setPaying(false);
    }
  }

  const client = selected ? clients.find((c) => c.client_id === selected.client_id) : undefined;
  const computed = detail?.computed;
  const balance = computed ? computed.balancePaise / 100 : 0;
  const lifecycleLabel = selected ? LIFECYCLE_LABEL[selected.lifecycle || "draft"] ?? "Draft" : "";
  const gstLines = detail?.lines ?? [];
  const isGst = gstLines.some((l) => l.tax_kind === "gst");
  const cgstPaise = gstLines.reduce((s, l) => s + l.cgst_paise, 0);
  const sgstPaise = gstLines.reduce((s, l) => s + l.sgst_paise, 0);
  const igstPaise = gstLines.reduce((s, l) => s + l.igst_paise, 0);
  const taxablePaise = computed?.totalPaise ? computed.totalPaise - cgstPaise - sgstPaise - igstPaise : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Fee recovery"
        title="Invoices, approvals & collections"
        description="Draft — approve — issue on a controlled number; payments stay on the ledger; corrections are audited."
      >
        <AiAssist task="collection_plan" label="Collection plan" />
        <a
          href="/api/export?type=invoices"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-subtle"
        >
          <Download className="h-4 w-4" /> Export CSV
        </a>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New draft invoice
        </Button>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Money label="Billed (issued)" value={compactInr(totals.billed / 100)} icon={<ReceiptIndianRupee className="h-4 w-4" />} />
        <Money label="Collected" value={compactInr(totals.collectedPaise / 100)} icon={<Wallet className="h-4 w-4" />} />
        <Money label="Outstanding" value={compactInr(totals.outstandingPaise / 100)} icon={<BellRing className="h-4 w-4" />} tone="gold" />
        <Money label="Overdue" value={compactInr(totals.overduePaise / 100)} icon={<Clock3 className="h-4 w-4" />} tone="rose" />
      </div>

      {receivables && receivables.aging.length > 0 ? (
        <SectionCard title="Receivables by age" subtitle="Aging is computed from the invoice due date — a reporting view, not a legal classification.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {receivables.aging.map((bucket) => (
              <div key={bucket.label} className="rounded-2xl border border-black/5 bg-white p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{bucket.label}</p>
                <p className="mt-1 text-[15px] font-extrabold text-ink">{compactInr(bucket.outstandingPaise / 100)}</p>
                <p className="text-[10px] text-muted">{bucket.invoiceCount} invoice(s)</p>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title={`${filtered.length} invoice(s)`}
        subtitle="Tax comes from the firm's configured treatments — the engine never injects a rate.  Drafts are not receivables until issued."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs
              options={FILTERS.map((f) => ({ value: f, label: f }))}
              value={filter}
              onChange={(value) => setFilter(value as LifecycleFilter)}
            />
            <SearchBox value={query} onChange={setQuery} placeholder="Search invoices…" className="w-full sm:w-56" />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState icon={<ReceiptIndianRupee className="h-5 w-5" />} title="No invoices in this view" description="Create a draft invoice or switch the filter." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[980px]">
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
                  const lc = inv.lifecycle || "draft";
                  const totalPaise = inv.total_paise ?? Math.round(inv.total_amount * 100);
                  const paidPaise = inv.paid_paise ?? Math.round(inv.paid_amount * 100);
                  const creditPaise = inv.credit_paise ?? 0;
                  const invBalance = Math.max(0, totalPaise - paidPaise - creditPaise);
                  const days = dayDiff(inv.due_date);
                  return (
                    <tr key={inv.invoice_id} className="border-t border-black/5 transition hover:bg-subtle/40">
                      <Td>
                        <p className="font-mono text-[11px] font-semibold text-ink">{inv.invoice_number || inv.invoice_id}</p>
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
                        {lc === "issued" && inv.status !== "Paid" && inv.status !== "Cancelled" ? (
                          <p className={`text-[10px] ${days < 0 ? "text-[#A33B2E]" : "text-muted"}`}>
                            {days < 0 ? `${Math.abs(days)} days late` : `in ${days} days`}
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted">{LIFECYCLE_LABEL[lc] ?? lc}</p>
                        )}
                      </Td>
                      <Td className="text-right">
                        <p className="text-xs font-extrabold text-ink">{inr(totalPaise / 100)}</p>
                        {paidPaise > 0 && inv.status !== "Paid" ? (
                          <p className="text-[10px] font-semibold text-[#8A6420]">{inr(invBalance / 100)} due</p>
                        ) : null}
                      </Td>
                      <Td>
                        <StatusPill status={inv.status} />
                        {lc !== "issued" && lc !== "cancelled" ? (
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted">{LIFECYCLE_LABEL[lc]}</p>
                        ) : null}
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => openInvoice(inv)}>View</Button>
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New draft invoice" description="A draft is never a receivable. The human number is allocated only when the invoice is issued.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Client">
            <select required className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Line description">
            <input required className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="GST retainer — Oct 2026" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input required type="number" min={1} className="input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </Field>
            <Field label="Unit price (₹)">
              <input required type="number" min={1} className="input" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Tax treatment">
            <select className="input" value={form.treatment_id} onChange={(e) => setForm({ ...form, treatment_id: e.target.value })}>
              <option value="TAX-NONE">No GST charged (not taxable)</option>
              <option value="TAX-GST-UNCONFIGURED">GST — rate set by the partner in settings</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice date"><input type="date" className="input" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          </div>
          <Field label="Notes (optional)">
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Shown on the invoice" />
          </Field>
          <div className="flex items-center justify-between rounded-2xl bg-subtle px-4 py-3 text-xs">
            <span className="font-semibold text-muted">Tax applies only on issue, from the configured treatment</span>
            <span className="text-sm font-extrabold text-ink">{inr(form.quantity * form.unit_price)}</span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create draft</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? (selected.invoice_number || selected.invoice_id) : "Invoice"}
        description={selected ? `${selected.client_name} · ${prettyDate(selected.invoice_date)} · ${lifecycleLabel}` : undefined}
        wide
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusPill status={selected.status} />
                <Badge tone="gold">{lifecycleLabel}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(selected.lifecycle || "draft") === "draft" ? (
                  <>
                    <Button size="sm" loading={busy} onClick={() => lifecycle("submit")}>
                      <Send className="h-3.5 w-3.5" /> Submit for approval
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelConfirm("void")}>
                      <Ban className="h-3.5 w-3.5" /> Void draft
                    </Button>
                  </>
                ) : null}
                {(selected.lifecycle || "draft") === "pending_approval" ? (
                  <>
                    <Button size="sm" loading={busy} onClick={() => lifecycle("approve")}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCancelConfirm("reject"); setActionReason(""); }}>
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </>
                ) : null}
                {(selected.lifecycle || "draft") === "approved" ? (
                  <Button size="sm" loading={busy} onClick={() => lifecycle("issue")}>
                    <Printer className="h-3.5 w-3.5" /> Issue invoice
                  </Button>
                ) : null}
                {(selected.lifecycle || "draft") === "issued" ? (
                  <>
                    <Button size="sm" variant="secondary" loading={busy} onClick={() => lifecycle("deliver")}>
                      <MessageCircle className="h-3.5 w-3.5" /> Send on WhatsApp
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCancelConfirm("credit-note"); setCreditAmount(Math.round(balance)); setActionReason(""); }}>
                      Credit note
                    </Button>
                  </>
                ) : null}
                {selected.pdf_object_key ? (
                  <a
                    href={`/api/invoices/${selected.invoice_id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[12px] font-semibold text-ink hover:bg-subtle"
                  >
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </a>
                ) : null}
                {(selected.lifecycle || "draft") === "issued" ? (
                  <Button size="sm" variant="ghost" onClick={() => setCancelConfirm("cancel")}>
                    <XCircle className="h-3.5 w-3.5" /> Cancel invoice
                  </Button>
                ) : null}
              </div>
            </div>

            {cancelConfirm ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#F2C6C0] bg-[#FBEAE7] p-3">
                {cancelConfirm === "credit-note" ? (
                  <input
                    type="number"
                    min={0.01}
                    max={balance}
                    className="input w-32"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(Number(e.target.value))}
                    placeholder="₹ to credit"
                  />
                ) : null}
                <input
                  className="input flex-1"
                  placeholder={PLACEHOLDER[cancelConfirm]}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                />
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    if (cancelConfirm === "cancel") void lifecycle("cancel", { reason: actionReason });
                    else if (cancelConfirm === "void") void lifecycle("void", { reason: actionReason });
                    else if (cancelConfirm === "reject") void lifecycle("reject", { reason: actionReason });
                    else if (cancelConfirm === "credit-note") void lifecycle("credit-note", { reason: actionReason, credit_total: creditAmount });
                    setCancelConfirm(null);
                  }}
                  disabled={actionReason.trim().length < 5 || (cancelConfirm === "credit-note" && creditAmount <= 0)}
                >
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCancelConfirm(null)}>Keep</Button>
              </div>
            ) : null}

            <div className="print-sheet max-h-[52vh] overflow-y-auto rounded-2xl border border-black/10 bg-white p-6 text-ink">
              <div className="flex items-start justify-between gap-4 border-b border-black/10 pb-4">
                <div>
                  <p className="text-base font-extrabold">{settings.legal_name || settings.firm_name || "CA Firm"}</p>
                  <p className="mt-1 max-w-[300px] text-[10px] leading-relaxed text-muted">{settings.firm_address ?? ""}</p>
                  <p className="text-[10px] text-muted">{[settings.firm_phone, settings.firm_email].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold uppercase tracking-[0.12em]">{(selected.lifecycle || "draft") === "issued" ? "Tax Invoice" : `${lifecycleLabel} draft`}</p>
                  <p className="mt-1 font-mono text-[11px] font-semibold">{selected.invoice_number || selected.invoice_id}</p>
                  <p className="text-[10px] text-muted">Date: {prettyDate(selected.invoice_date)}</p>
                  <p className="text-[10px] text-muted">Due: {prettyDate(selected.due_date)}</p>
                  {settings.firm_gstin || settings.gstin ? <p className="mt-1 text-[10px] text-muted">GSTIN: {settings.gstin || settings.firm_gstin}</p> : null}
                </div>
              </div>

              <div className="grid gap-4 py-4 text-[11px] sm:grid-cols-2">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Billed to</p>
                  <p className="mt-1 font-semibold">{selected.client_name}</p>
                  {client?.contact_person ? <p className="text-muted">{client.contact_person}</p> : null}
                  {client?.city ? <p className="text-muted">{client.city}, {client.state}</p> : null}
                  {client?.gst_number ? <p className="text-muted">GSTIN: {client.gst_number}</p> : null}
                </div>
                <div className="sm:text-right">
                  <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">Supply details</p>
                  <p className="mt-1 text-muted">Place of supply: {client?.state || "—"}{client?.gst_state_code ? ` (${client.gst_state_code})` : ""}</p>
                  <p className="text-muted">Tax as configured per treatment; none shown where not applicable</p>
                </div>
              </div>

              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-y border-black/10 text-left text-[9px] uppercase tracking-[0.1em] text-muted">
                    <th className="py-2">Description</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Taxable</th>
                    <th className="py-2 text-right">Tax</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr><td colSpan={6} className="py-3 text-center text-muted">Loading…</td></tr>
                  ) : (gstLines.length === 0 ? (
                    <tr><td colSpan={6} className="py-3 text-muted">{selected.service_description}</td></tr>
                  ) : gstLines.map((line) => (
                    <tr key={line.line_id} className="border-b border-black/5">
                      <td className="py-2">{line.description}</td>
                      <td className="py-2 text-right">{line.quantity}</td>
                      <td className="py-2 text-right">{inr(line.unit_price_paise / 100)}</td>
                      <td className="py-2 text-right">{inr(line.taxable_paise / 100)}</td>
                      <td className="py-2 text-right">{inr((line.cgst_paise + line.sgst_paise + line.igst_paise) / 100)}</td>
                      <td className="py-2 text-right">{inr(line.line_total_paise / 100)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>

              <div className="ml-auto mt-3 w-full max-w-[280px] space-y-1 text-[11px]">
                {computed ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted">Taxable value</span><span>{inr(taxablePaise / 100)}</span></div>
                    {isGst ? (
                      <>
                        {cgstPaise || sgstPaise ? (
                          <>
                            <div className="flex justify-between"><span className="text-muted">CGST</span><span>{inr(cgstPaise / 100)}</span></div>
                            <div className="flex justify-between"><span className="text-muted">SGST</span><span>{inr(sgstPaise / 100)}</span></div>
                          </>
                        ) : (
                          <div className="flex justify-between"><span className="text-muted">IGST</span><span>{inr(igstPaise / 100)}</span></div>
                        )}
                      </>
                    ) : null}
                    <div className="flex justify-between border-t border-black/10 pt-1 font-extrabold"><span>Total</span><span>{inr(computed.totalPaise / 100)}</span></div>
                    {(computed.paidPaise || 0) > 0 ? <div className="flex justify-between text-muted"><span>Recorded payments</span><span>{inr(computed.paidPaise / 100)}</span></div> : null}
                    {(computed.creditPaise || 0) > 0 ? <div className="flex justify-between text-muted"><span>Credit notes</span><span>{inr(computed.creditPaise / 100)}</span></div> : null}
                    <div className="flex justify-between font-bold text-[#A33B2E]"><span>Balance due</span><span>{inr(computed.balancePaise / 100)}</span></div>
                  </>
                ) : null}
              </div>

              <div className="mt-5 flex items-end justify-between border-t border-black/10 pt-3 text-[10px] text-muted">
                <p className="max-w-[340px] leading-relaxed">
                  {settings.payment_instructions ? settings.payment_instructions : ""}
                </p>
                <div className="text-right">
                  <p className="font-semibold text-ink">For {settings.legal_name || settings.firm_name || "the firm"}</p>
                  <p className="mt-6">Authorised signatory</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-black/5 p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Payment ledger</p>
                {detailLoading ? <p className="py-4 text-center text-[11px] text-muted">Loading…</p> : null}
                {!detailLoading && (detail?.payments.length ?? 0) === 0 ? (
                  <p className="py-3 text-[11px] text-muted">No payments recorded yet.</p>
                ) : null}
                <div className="space-y-2">
                  {(detail?.payments ?? []).map((p) => (
                    <div key={p.payment_id} className="flex items-center justify-between gap-2 border-b border-black/5 pb-2 last:border-0 last:pb-0">
                      <div>
                        <p className="text-xs font-semibold text-ink">{inr(p.amount)} · {p.mode}</p>
                        <p className="text-[10px] text-muted">{prettyDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}</p>
                      </div>
                      <Badge tone={p.status === "Reversed" ? "gold" : "green"}>{p.status ?? "Received"}</Badge>
                    </div>
                  ))}
                </div>
                {(detail?.creditNotes.length ?? 0) > 0 ? (
                  <p className="mt-3 text-[11px] text-muted">
                    Credit notes: {(detail?.creditNotes ?? []).map((cn) => `${cn.number} (${inr(cn.total_paise / 100)})`).join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl bg-subtle p-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Record a payment</p>
                {lifecycleLabel !== "Issued" ? (
                  <p className="py-3 text-[11px] text-muted">Payments attach to issued invoices only — issue the invoice first.</p>
                ) : balance <= 0 ? (
                  <p className="py-3 text-[11px] text-muted">This invoice is fully settled.</p>
                ) : (
                  <form onSubmit={recordPayment} className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Amount">
                        <input
                          required
                          type="number"
                          min={0.01}
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

            {(detail?.events.length ?? 0) > 0 ? (
              <SectionCard title="History" subtitle="Append-only invoice events — creation, approval, issue, delivery, payments.">
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto">
                  {(detail?.events ?? []).slice().reverse().map((e) => (
                    <div key={e.event_id} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                      <span className="rounded-full bg-sage px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sage-ink">{e.event.replace(/_/g, " ")}</span>
                      <span className="text-muted">{prettyDate(e.created_at)}</span>
                      <span className="text-ink">{e.actor}</span>
                      <span className="text-muted">{e.detail}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

const PLACEHOLDER: Record<string, string> = {
  void: "Reason for voiding the draft",
  cancel: "Reason for cancelling the issued invoice (required)",
  reject: "Why is this draft returned to the preparer?",
  "credit-note": "Reason for the credit note (required)",
};

const ACTION_LABEL: Record<string, string> = {
  submit: "Submitted for approval",
  approve: "Approved",
  reject: "Returned to draft",
  issue: "Issued — human number allocated",
  void: "Draft voided",
  cancel: "Invoice cancelled — audit trail recorded",
  "credit-note": "Credit note issued",
  deliver: "WhatsApp delivery sent",
};

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
