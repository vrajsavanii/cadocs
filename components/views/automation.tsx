"use client";

import * as React from "react";
import {
  Bot,
  Check,
  ExternalLink,
  Inbox,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Stat, TableShell, Td, Th, cn } from "../ui";
import { useMutation } from "./shared";
import { ClientEngine } from "./client-engine";
import { useToast } from "../interactive";
import { mailtoLink, prettyDate, whatsappLink } from "@/lib/format";
import type { AutomationCadence, AutomationKind, AutomationMode, AutomationRule, AutomationRun, Message } from "@/lib/types";

export type RuleWithExplain = AutomationRule & { explain: string };

export type PresetShape = {
  id: string;
  name: string;
  action: AutomationKind;
  params: Record<string, unknown>;
  mode: AutomationMode;
  cadence: AutomationCadence;
  why: string;
};

export type ActionShape = { kind: AutomationKind; label: string; blurb: string };

export type RuleDraftShape = {
  name: string;
  action: AutomationKind;
  params: Record<string, unknown>;
  mode: AutomationMode;
  cadence: AutomationCadence;
  explanation: string;
  source: "rules" | "ai-assisted";
};

const ACTION_LABEL: Record<string, string> = {
  chase_documents: "Documents",
  dunning: "Fee recovery",
  generate_compliance: "Recurring filings",
  escalate_overdue: "Escalation",
  dsc_watch: "DSC watch",
  notice_watch: "Notice watch",
};

const RUN_TONE: Record<string, "green" | "amber" | "red" | "neutral" | "blue"> = {
  ok: "green",
  "pending-approval": "amber",
  skipped: "neutral",
  partial: "amber",
  failed: "red",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AutomationView({
  rules,
  runs,
  queued,
  activity,
  presets,
  actions,
  canManage,
  backlog,
}: {
  rules: RuleWithExplain[];
  runs: AutomationRun[];
  queued: Message[];
  activity: { runs: number; actions: number };
  presets: PresetShape[];
  actions: ActionShape[];
  canManage: boolean;
  backlog: { documents: number; invoices: number; clients: number };
}) {
  const { busy, mutate } = useMutation();
  const { toast } = useToast();
  const [draftText, setDraftText] = React.useState("");
  const [draft, setDraft] = React.useState<RuleDraftShape | null>(null);
  const [planning, setPlanning] = React.useState(false);

  const active = rules.filter((r) => r.enabled).length;
  const approvalMode = rules.filter((r) => r.mode === "approval").length;

  async function runSweep(dryRun: boolean) {
    const result = await mutate<{ summary: string; actions: number; considered: number }>(
      "/api/automation/run",
      "POST",
      { include_not_due: true, dry_run: dryRun },
      undefined,
    );
    if (result) toast(result.summary, dryRun ? "info" : "success");
  }

  async function plan() {
    if (!draftText.trim() || planning) return;
    setPlanning(true);
    try {
      const res = await fetch("/api/automation/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draftText }),
      });
      const data = (await res.json()) as { draft?: RuleDraftShape | null; message?: string };
      setDraft(data.draft ?? null);
      if (!data.draft && data.message) {
        mutate("/api/automation/plan", "POST", { text: draftText }, data.message);
      }
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="The automation layer"
        title="Automation"
        description="Standing rules that do the repetitive half of the practice: chasing, dunning, generating filings and watching deadlines — audited, reversible, and never sending anything by itself."
      >
        {canManage ? (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runSweep(true)}>
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Preview
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void runSweep(false)}>
              <Play className="h-3.5 w-3.5" /> Run now
            </Button>
          </>
        ) : null}
      </PageHeader>

      <ClientEngine canManage={canManage} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active rules" value={String(active)} hint={`${rules.length} configured${approvalMode ? ` · ${approvalMode} need approval` : ""}`} icon={<Zap className="h-4 w-4" />} />
        <Stat label="Outbox waiting" value={String(queued.length)} hint="Prepared, not yet sent" icon={<Inbox className="h-4 w-4" />} tone="gold" />
        <Stat label="Actions · 7 days" value={String(activity.actions)} hint={`${activity.runs} run(s) recorded`} icon={<Sparkles className="h-4 w-4" />} />
        <Stat label="Backlog it can clear" value={String(backlog.documents + backlog.invoices)} hint={`${backlog.documents} document chases · ${backlog.invoices} dunning targets`} icon={<Bot className="h-4 w-4" />} />
      </div>

      {canManage ? (
        <Card className="mt-4 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sage text-sage-ink">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-ink">Describe an automation</p>
              <p className="mt-0.5 text-xs text-muted">
                “Chase documents older than a week on WhatsApp” · “Remind clients about invoices 30 days late” · “Create GSTR-3B every month due on the 20th”
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void plan();
                  }}
                  placeholder="Describe the rule in one sentence…"
                  className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-green/40"
                />
                <Button size="sm" className="h-10 shrink-0" loading={planning} onClick={() => void plan()}>
                  Plan it
                </Button>
              </div>

              {draft ? (
                <div className="animate-rise mt-3 rounded-2xl border border-green/20 bg-[#F2F7F2] p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-extrabold text-ink">{draft.name}</p>
                    <Badge tone="green">{ACTION_LABEL[draft.action] ?? draft.action}</Badge>
                    <Badge tone="neutral">{draft.cadence}</Badge>
                    <Badge tone={draft.mode === "auto" ? "sage" : "amber"}>{draft.mode === "auto" ? "Runs automatically" : "Needs approval each run"}</Badge>
                    {draft.source === "ai-assisted" ? <Badge tone="purple">AI-assisted</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-muted">{draft.explanation}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        const created = await mutate<{ rule: AutomationRule }>(
                          "/api/automation",
                          "POST",
                          { name: draft.name, action: draft.action, params: draft.params, mode: draft.mode, cadence: draft.cadence },
                          "Automation created",
                        );
                        if (created) {
                          setDraft(null);
                          setDraftText("");
                        }
                      }}
                    >
                      <Check className="h-3.5 w-3.5" /> Create rule
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mt-4 p-4 text-xs text-muted">
          Read-only view. A partner or manager configures automation; article assistants can see what it is doing.
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Rules ─────────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Zap className="h-4 w-4 text-green" />
            <p className="text-sm font-extrabold text-ink">Standing rules</p>
            <span className="ml-auto text-[11px] text-muted">{active} active</span>
          </div>

          {rules.length === 0 ? (
            <EmptyState
              icon={<Zap className="h-5 w-5" />}
              title="No automation yet"
              description="Add a rule from the playbook on the right, or describe what you want in the box above."
            />
          ) : (
            <ul className="divide-y divide-black/5">
              {rules.map((rule) => (
                <li key={rule.rule_id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", rule.enabled ? "bg-[#3E8A52]" : "bg-black/20")} />
                    <p className="text-sm font-extrabold text-ink">{rule.name}</p>
                    <Badge tone="sage">{ACTION_LABEL[rule.action] ?? rule.action}</Badge>
                    <Badge tone={rule.mode === "auto" ? "green" : "amber"}>{rule.mode === "auto" ? "auto" : "approval"}</Badge>
                    <Badge tone="neutral">{rule.cadence}</Badge>
                    <span suppressHydrationWarning className="ml-auto text-[10px] text-muted">
                      {rule.last_run_at ? `ran ${timeAgo(rule.last_run_at)}` : "not run yet"} · {rule.run_count} run{rule.run_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{rule.explain}</p>

                  {canManage ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void mutate(`/api/automation/${rule.rule_id}`, "PATCH", { enabled: !rule.enabled }, rule.enabled ? "Rule paused" : "Rule resumed")}
                        className={cn(
                          "relative h-6 w-11 shrink-0 rounded-full transition",
                          rule.enabled ? "bg-green" : "bg-black/15",
                        )}
                        aria-label={rule.enabled ? "Pause rule" : "Resume rule"}
                      >
                        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", rule.enabled ? "left-[22px]" : "left-0.5")} />
                      </button>

                      <select
                        value={rule.mode}
                        onChange={(e) => void mutate(`/api/automation/${rule.rule_id}`, "PATCH", { mode: e.target.value }, "Mode updated")}
                        className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-semibold text-ink"
                      >
                        <option value="auto">auto</option>
                        <option value="approval">approval</option>
                      </select>

                      <select
                        value={rule.cadence}
                        onChange={(e) => void mutate(`/api/automation/${rule.rule_id}`, "PATCH", { cadence: e.target.value }, "Cadence updated")}
                        className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] font-semibold text-ink"
                      >
                        <option value="daily">daily</option>
                        <option value="weekly">weekly</option>
                        <option value="monthly">monthly</option>
                      </select>

                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate("/api/automation/run", "POST", { rule_ids: [rule.rule_id], dry_run: true })}>
                        <Play className="h-3.5 w-3.5" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate("/api/automation/run", "POST", { rule_ids: [rule.rule_id] }, `${rule.name} executed`)}>
                        Run
                      </Button>
                      <button
                        onClick={() => void mutate(`/api/automation/${rule.rule_id}`, "DELETE", undefined, "Rule deleted")}
                        className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-[#FBEAE7] hover:text-[#A33B2E]"
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Presets ───────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
            <Plus className="h-4 w-4 text-green" />
            <p className="text-sm font-extrabold text-ink">The CA playbook</p>
          </div>
          <ul className="divide-y divide-black/5">
            {presets
              .filter((preset) => !rules.some((rule) => rule.name === preset.name))
              .map((preset) => (
                <li key={preset.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-extrabold text-ink">{preset.name}</p>
                    <Badge tone="neutral" className="ml-auto">{preset.cadence}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{preset.why}</p>
                  {canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => void mutate("/api/automation", "POST", { preset_id: preset.id }, "Automation added")}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add rule
                    </Button>
                  ) : null}
                </li>
              ))}
            {presets.filter((preset) => !rules.some((rule) => rule.name === preset.name)).length === 0 ? (
              <li className="px-5 py-6 text-center text-xs text-muted">Every playbook rule is already configured.</li>
            ) : null}
          </ul>
        </Card>
      </div>

      {/* ── Outbox ──────────────────────────────────────────────────────────── */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <Inbox className="h-4 w-4 text-gold" />
          <p className="text-sm font-extrabold text-ink">Outbox</p>
          <span className="ml-auto text-[11px] text-muted">{queued.length} prepared</span>
        </div>
        {queued.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title="Nothing waiting"
            description="When automation queues a chaser or reminder it lands here with a one-click WhatsApp/email link."
          />
        ) : (
          <ul className="divide-y divide-black/5">
            {queued.map((message) => {
              const preview = message.body.split("\n").slice(0, 2).join(" ");
              const link =
                message.channel === "WhatsApp"
                  ? whatsappLink(message.to_address, message.body)
                  : mailtoLink(message.to_address, message.subject || "Reminder", message.body);
              return (
                <li key={message.message_id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FBF1DF] text-[11px] font-extrabold text-[#8A6420]">
                    {message.channel === "WhatsApp" ? "WA" : "@"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-extrabold text-ink">{message.recipient_name}</p>
                      <Badge tone="amber">Queued</Badge>
                      <span suppressHydrationWarning className="text-[10px] text-muted">{timeAgo(message.created_at)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{preview}…</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[11px] font-bold text-ink ring-1 ring-black/10 transition hover:bg-subtle"
                    >
                      <ExternalLink className="h-3 w-3" /> Open {message.channel}
                    </a>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void mutate(`/api/messages/${message.message_id}`, "PATCH", { status: "Sent" }, "Marked sent")}>
                      <Check className="h-3.5 w-3.5" /> Sent
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(`/api/messages/${message.message_id}`, "PATCH", { status: "Dismissed" }, "Dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Run history ─────────────────────────────────────────────────────── */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <Bot className="h-4 w-4 text-ink" />
          <p className="text-sm font-extrabold text-ink">Run history</p>
          <span className="ml-auto text-[11px] text-muted">last {runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <EmptyState icon={<Bot className="h-5 w-5" />} title="No runs yet" description="Press Run now, or let the daily sweep take it from here." />
        ) : (
          <TableShell>
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-black/5 bg-subtle/60">
                <tr>
                  <Th>Rule</Th>
                  <Th>Result</Th>
                  <Th>What happened</Th>
                  <Th className="text-right">When</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {runs.map((run) => (
                  <tr key={run.run_id}>
                    <Td className="font-semibold">{run.rule_name}</Td>
                    <Td>
                      <Badge tone={RUN_TONE[run.status] ?? "neutral"}>
                        {run.status === "pending-approval" ? "approval" : run.status}
                      </Badge>
                    </Td>
                    <Td className="max-w-[420px] text-xs text-muted">{run.summary}</Td>
                    <Td className="whitespace-nowrap text-right text-[11px] text-muted">
                      <span suppressHydrationWarning>
                        {prettyDate(run.finished_at.slice(0, 10))} · {timeAgo(run.finished_at)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        A rule is a <span className="font-semibold text-ink">standing approval</span>: you configure it once and the sweep runs it. Every run is written to
        the audit trail with what it created. Automation never sends a message — it prepares it here for a human to send, so “sent” always means sent.
        {approvalMode ? ` ${approvalMode} rule(s) are set to approval mode and will wait in the copilot.` : ""}
      </p>
    </div>
  );
}
