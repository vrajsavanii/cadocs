"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCircle2, MessageCircle, Play, ReceiptIndianRupee, RefreshCw, ShieldCheck, TimerReset } from "lucide-react";
import type { EngineStatus } from "@/lib/reminders";
import type { ReminderRunSummary } from "@/lib/types";
import { Badge, Button, Field } from "../ui";
import { useToast } from "../interactive";
import { prettyDateTime } from "@/lib/format";
import { inr } from "@/lib/format";

export function ClientEngine({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [status, setStatus] = React.useState<EngineStatus | null>(null);
  const [busy, setBusy] = React.useState<"run" | "preview" | "save" | "bill" | null>(null);
  const [summary, setSummary] = React.useState<ReminderRunSummary | null>(null);
  const [draft, setDraft] = React.useState({ reminder_cap: 3, reminder_gap_days: 3, auto_billing: true, invoice_due_days: 7, gst_rate: 18 });

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/reminders");
      if (!res.ok) return;
      const data = (await res.json()) as EngineStatus;
      setStatus(data);
      setDraft({
        reminder_cap: data.config.reminder_cap,
        reminder_gap_days: data.config.reminder_gap_days,
        auto_billing: data.config.auto_billing,
        invoice_due_days: data.config.invoice_due_days,
        gst_rate: data.config.gst_rate,
      });
    } catch {
      // The page still works with the rest of automation; the panel retries on run.
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "run");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const data = (await res.json().catch(() => ({}))) as ReminderRunSummary & { error?: string; status?: EngineStatus };
      if (!res.ok) throw new Error(data.error || "Could not run the client engine");
      setSummary(data);
      if (data.status) setStatus(data.status);
      toast(
        dryRun
          ? `Preview: ${data.messages_queued} message(s) would go out, ${data.invoices_created} invoice(s).`
          : `${data.messages_queued + data.messages_sent} message(s) prepared · ${data.invoices_created} invoice(s) · ${data.requests_cleared} packet(s) cleared`,
        "success",
      );
      if (!dryRun) router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not run the client engine", "error");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const res = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: EngineStatus };
      if (!res.ok) throw new Error(data.error || "Could not save the policy");
      if (data.status) setStatus(data.status);
      toast("Reminder policy saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the policy", "error");
    } finally {
      setBusy(null);
    }
  }

  async function bill() {
    setBusy("bill");
    try {
      const res = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: number; messages?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not generate invoices");
      toast(`${data.created ?? 0} invoice(s) created${data.messages ? ` · ${data.messages} WhatsApp message(s)` : ""}`);
      await load();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not generate invoices", "error");
    } finally {
      setBusy(null);
    }
  }

  const config = status?.config;

  return (
    <div className="mb-4 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_14px_40px_-30px_rgba(25,32,28,0.4)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 bg-subtle/50 px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold text-ink"><BellRing className="h-4 w-4 text-green" /> Client document engine</p>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted">
            Opens each service's current period, asks for its checklist, reminds at a fixed gap — never more than three times — and stops the moment the papers arrive. Completed work becomes a WhatsApp invoice.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={config?.provider === "cloud" && config.auto_send ? "green" : "sage"}>
            <MessageCircle className="h-3 w-3" /> {config?.provider === "cloud" ? (config.auto_send ? "WhatsApp Cloud · auto-send" : "WhatsApp Cloud · review mode") : "Outbox · one-tap send"}
          </Badge>
          <Badge tone={config?.auto_billing ? "green" : "neutral"}><ReceiptIndianRupee className="h-3 w-3" /> Auto-billing {config?.auto_billing ? "on" : "off"}</Badge>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
        <div className="border-b border-black/5 p-5 lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Open packets" value={status?.open_requests ?? "—"} />
            <Metric label="Due now" value={status?.due_now ?? "—"} tone="gold" />
            <Metric label="At 3-reminder cap" value={status?.exhausted ?? "—"} tone="rose" />
            <Metric label="Cleared this month" value={status?.cleared_this_month ?? "—"} tone="green" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void run(false)} loading={busy === "run"} disabled={!canManage || busy !== null}>
              <Play className="h-3.5 w-3.5" /> Run now
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void run(true)} loading={busy === "preview"} disabled={!canManage || busy !== null}>
              <RefreshCw className="h-3.5 w-3.5" /> Preview
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void bill()} loading={busy === "bill"} disabled={!canManage || busy !== null}>
              <ReceiptIndianRupee className="h-3.5 w-3.5" /> Bill completed work
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Last run {config?.last_run_at ? prettyDateTime(config.last_run_at) : "never"}{config?.last_run_summary ? ` · ${config.last_run_summary}` : ""}
          </p>
          {status?.whatsapp && !status.whatsapp.configured ? (
            <p className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[10px] leading-relaxed text-muted">
              Messages are prepared in the outbox with a WhatsApp deep link. To auto-send, set {status.whatsapp.missing.join(", ")} and an approved utility template, then restart with <span className="font-mono">WHATSAPP_AUTO_SEND=1</span>. Consent is still checked per client.
            </p>
          ) : null}
          {summary ? (
            <div className="mt-3 rounded-2xl border border-black/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                <CheckCircle2 className="h-3 w-3 text-green" /> Last action
              </p>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-ink sm:grid-cols-4">
                <span>Messages <b>{summary.messages_queued + summary.messages_sent}</b></span>
                <span>Invoices <b>{summary.invoices_created}</b></span>
                <span>Cleared <b>{summary.requests_cleared}</b></span>
                <span>Cycles <b>{summary.cycles_created}</b></span>
              </div>
              {summary.details.length ? (
                <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-[10px] text-muted">
                  {summary.details.slice(0, 8).map((detail, index) => (
                    <li key={index} className="truncate">{detail.client} · {detail.action} · {detail.detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="p-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Reminder cap" hint="Hard maximum of 3">
              <select className="input" value={draft.reminder_cap} onChange={(e) => setDraft({ ...draft, reminder_cap: Number(e.target.value) })} disabled={!canManage}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n} reminder{n === 1 ? "" : "s"}</option>)}
              </select>
            </Field>
            <Field label="Gap between reminders">
              <select className="input" value={draft.reminder_gap_days} onChange={(e) => setDraft({ ...draft, reminder_gap_days: Number(e.target.value) })} disabled={!canManage}>
                {[2, 3, 4, 5, 7, 10, 14].map((n) => <option key={n} value={n}>Every {n} days</option>)}
              </select>
            </Field>
            <Field label="Invoice due">
              <select className="input" value={draft.invoice_due_days} onChange={(e) => setDraft({ ...draft, invoice_due_days: Number(e.target.value) })} disabled={!canManage}>
                {[3, 7, 15, 30].map((n) => <option key={n} value={n}>{n} days</option>)}
              </select>
            </Field>
            <Field label="GST on fees">
              <select className="input" value={draft.gst_rate} onChange={(e) => setDraft({ ...draft, gst_rate: Number(e.target.value) })} disabled={!canManage}>
                {[0, 18].map((n) => <option key={n} value={n}>{n}% {n === 0 ? "(no GST)" : "GST"}</option>)}
              </select>
            </Field>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl bg-subtle px-3 py-2">
            <input type="checkbox" checked={draft.auto_billing} onChange={(e) => setDraft({ ...draft, auto_billing: e.target.checked })} className="mt-0.5 h-3.5 w-3.5 accent-[#3B5244]" disabled={!canManage} />
            <span>
              <span className="block text-[11px] font-bold text-ink">Invoice when a cycle closes</span>
              <span className="block text-[10px] text-muted">Uses the engagement fee, adds GST, and queues the invoice WhatsApp message. {status ? `${status.invoices_waiting} completed cycle(s) waiting${status.billing_value ? ` · ${inr(status.billing_value)}` : ""}.` : ""}</span>
            </span>
          </label>
          <div className="mt-3 flex items-center justify-between">
            <p className="flex items-center gap-1 text-[10px] text-muted"><ShieldCheck className="h-3 w-3" /> {status?.opted_out ?? 0} client(s) without WhatsApp consent</p>
            <Button size="sm" variant="secondary" onClick={() => void save()} loading={busy === "save"} disabled={!canManage}>
              <TimerReset className="h-3.5 w-3.5" /> Save policy
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "sage" }: { label: string; value: number | string; tone?: "sage" | "gold" | "rose" | "green" }) {
  const tones = { sage: "bg-subtle text-ink", gold: "bg-gold-soft text-gold", rose: "bg-[#FBEAE7] text-[#A33B2E]", green: "bg-[#E8F2EA] text-[#2F6B3F]" };
  return (
    <div className={`rounded-2xl px-3 py-2 ${tones[tone]}`}>
      <p className="text-[9px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold leading-tight">{value}</p>
    </div>
  );
}
