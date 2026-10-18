"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowUp, Check, CheckCircle2, Command, Loader2, Sparkles, ShieldCheck, X,
} from "lucide-react";
import { cn } from "./ui";
import { Markdown } from "./markdown";

type Step = { tool: string; kind: "read" | "write"; summary: string };
type Proposal = { action_id: string; tool: string; title: string; args: Record<string, unknown> };
type Entry =
  | { id: number; role: "user"; text: string }
  | {
      id: number; role: "assistant"; text: string; steps: Step[];
      proposal?: Proposal | null; proposalState?: "pending" | "approved" | "rejected" | "error";
      proposalResult?: string;
    };

type Usage = { calls_today: number; limit: number; provider: string | null; model: string | null; pending_actions: number };

const SUGGESTIONS: Record<string, string[]> = {
  "/clients": ["Summarise this client", "Who owes us the most?", "Plan my week"],
  "/invoices": ["Build a collection plan", "What is overdue?", "Who owes us the most?"],
  "/compliance": ["Plan my week", "What filings are overdue?", "Which documents are waiting?"],
  "/documents": ["Which documents are waiting?", "Plan my week", "What is overdue?"],
  "/reports": ["Explain this month", "Who owes us the most?", "Plan my week"],
};
const DEFAULT_SUGGESTIONS = [
  "Plan my week",
  "What is overdue right now?",
  "Who owes us the most?",
  "Which documents are waiting?",
];

function suggestionsFor(pathname: string): string[] {
  const key = Object.keys(SUGGESTIONS).find((p) => pathname.startsWith(p));
  return key ? SUGGESTIONS[key]! : DEFAULT_SUGGESTIONS;
}

/**
 * The AI layer's front door: available on every page, keyboard-first.
 * Reads run immediately; writes arrive as proposals the user must approve.
 */
export function AiCommand() {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const loadUsage = React.useCallback(async () => {
    try {
      const res = await fetch("/api/ai/usage");
      if (res.ok) setUsage((await res.json()) as Usage);
    } catch {
      // non-blocking
    }
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("ca:ai-open", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ca:ai-open", onOpen as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadUsage();
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open, loadUsage]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, loading]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setInput("");
    setEntries((prev) => [...prev, { id: Date.now(), role: "user", text: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string; steps?: Step[]; proposal?: Proposal | null; error?: string;
        calls_today?: number; limit?: number;
      };
      if (!res.ok) {
        setEntries((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", text: data.error || "The assistant is unavailable.", steps: [] },
        ]);
        return;
      }
      setEntries((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: data.reply || "No answer.",
          steps: data.steps ?? [],
          proposal: data.proposal ?? null,
          proposalState: data.proposal ? "pending" : undefined,
        },
      ]);
      if (data.calls_today !== undefined && data.limit !== undefined) {
        setUsage((u) => ({
          calls_today: data.calls_today!,
          limit: data.limit!,
          provider: u?.provider ?? null,
          model: u?.model ?? null,
          pending_actions: data.proposal ? (u?.pending_actions ?? 0) + 1 : (u?.pending_actions ?? 0),
        }));
      }
    } catch {
      setEntries((prev) => [
        ...prev,
        { id: Date.now() + 2, role: "assistant", text: "Could not reach the assistant.", steps: [] },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function decide(entryId: number, actionId: string, decision: "approve" | "reject") {
    setDeciding(actionId);
    try {
      const res = await fetch(`/api/ai/actions/${actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await res.json().catch(() => ({}))) as { summary?: string; message?: string; error?: string };
      setEntries((prev) =>
        prev.map((e) =>
          e.role === "assistant" && e.proposal?.action_id === actionId
            ? {
                ...e,
                proposalState: res.ok ? (decision === "approve" ? "approved" : "rejected") : "error",
                proposalResult: res.ok ? (decision === "approve" ? data.summary ?? "Saved." : "Rejected — nothing was written.") : data.error,
              }
            : e,
        ),
      );
      if (res.ok) {
        router.refresh();
        void loadUsage();
      }
    } finally {
      setDeciding(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-3 pt-[8vh] sm:p-6 sm:pt-[10vh]">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Practice AI"
        className="animate-rise relative flex max-h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-black/5 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-green text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold text-ink">Practice AI</p>
            <p className="truncate text-[10px] text-muted">
              {usage?.provider ? `${usage.provider} · ${usage.model ?? ""}` : "Local rules — add a provider key to upgrade"}
            </p>
          </div>
          <span className="hidden rounded-full bg-subtle px-2 py-1 text-[10px] font-semibold text-muted sm:inline">
            {usage ? `${usage.calls_today}/${usage.limit} today` : "—"}
          </span>
          <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted transition hover:bg-black/5 hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {entries.length === 0 ? (
            <div className="py-2">
              <p className="text-[11px] font-semibold text-muted">Ask anything, or say what should happen:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestionsFor(pathname).map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="rounded-full bg-subtle px-3 py-1.5 text-[11px] font-semibold text-ink transition hover:bg-sage">
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-green" />
                Reads run immediately. Anything that writes — a document request, a task, a logged reminder — waits for your approval.
              </p>
            </div>
          ) : null}

          {entries.map((e) =>
            e.role === "user" ? (
              <div key={e.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-green px-3.5 py-2 text-xs text-white">{e.text}</div>
              </div>
            ) : (
              <div key={e.id} className="space-y-1.5">
                <div className="rounded-2xl bg-subtle px-3.5 py-2.5 text-xs leading-relaxed text-ink">
                  <Markdown text={e.text} />
                </div>
                {e.steps.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {e.steps.map((s, i) => (
                      <span
                        key={`${s.tool}-${i}`}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                          s.kind === "write" ? "bg-gold-soft text-gold" : "bg-white text-muted ring-1 ring-black/5",
                        )}
                      >
                        {s.tool.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                ) : null}
                {e.proposal ? (
                  <div
                    className={cn(
                      "rounded-2xl border p-3",
                      e.proposalState === "approved"
                        ? "border-green/25 bg-sage/40"
                        : e.proposalState === "pending" || !e.proposalState
                          ? "border-gold/30 bg-gold-soft/30"
                          : "border-black/10 bg-subtle/60",
                    )}
                  >
                    <p
                      className={cn(
                        "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide",
                        e.proposalState === "approved"
                          ? "text-green"
                          : e.proposalState === "pending" || !e.proposalState
                            ? "text-gold"
                            : "text-muted",
                      )}
                    >
                      {e.proposalState === "approved" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : e.proposalState === "pending" || !e.proposalState ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      {e.proposalState === "approved"
                        ? "Approved"
                        : e.proposalState === "rejected"
                          ? "Rejected"
                          : e.proposalState === "error"
                            ? "Failed"
                            : "Needs approval"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-ink">{e.proposal.title}</p>
                    {e.proposalState === "pending" ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => void decide(e.id, e.proposal!.action_id, "approve")}
                          disabled={deciding === e.proposal.action_id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-green px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-green-dark disabled:opacity-60"
                        >
                          {deciding === e.proposal.action_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => void decide(e.id, e.proposal!.action_id, "reject")}
                          disabled={deciding === e.proposal.action_id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-muted ring-1 ring-black/10 transition hover:text-ink disabled:opacity-60"
                        >
                          <X className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    ) : (
                      <p className={cn("mt-1.5 flex items-center gap-1 text-[11px] font-semibold", e.proposalState === "approved" ? "text-green" : e.proposalState === "rejected" ? "text-muted" : "text-[#A33B2E]")}>
                        {e.proposalState === "approved" ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {e.proposalResult ||
                          (e.proposalState === "approved" ? "Saved." : e.proposalState === "rejected" ? "Rejected — nothing was written." : "Failed.")}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ),
          )}
          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl bg-subtle px-3.5 py-2.5 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the practice data…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="border-t border-black/5 p-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-1.5 focus-within:border-green/40 focus-within:ring-2 focus-within:ring-green/10">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              placeholder="Ask, or say: request bank statement from Sharma Textiles…"
              className="max-h-24 flex-1 resize-none bg-transparent px-2.5 py-2 text-xs text-ink outline-none placeholder:text-muted/70"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-green text-white transition hover:bg-green-dark disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 flex items-center justify-between px-1 text-[9px] text-muted">
            <span>Enter to send · Esc to close</span>
            <span className="inline-flex items-center gap-1"><Command className="h-2.5 w-2.5" /> J opens this anywhere</span>
          </p>
        </form>
      </div>
    </div>
  );
}