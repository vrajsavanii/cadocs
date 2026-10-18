"use client";

import * as React from "react";
import { Loader2, Sparkles, ShieldCheck } from "lucide-react";
import type { AssistTask } from "@/lib/ai-prompts";
import { Button } from "./ui";
import { Modal } from "./interactive";
import { Markdown } from "./markdown";

type Props = {
  task: AssistTask;
  id?: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "soft" | "danger";
  size?: "sm" | "md";
  title?: string;
};

type Step = { tool: string; kind: "read" | "write"; summary: string };

/**
 * Inline AI assist: one button where the work happens, opening a modal with an
 * answer grounded in tool calls. Advisory only — nothing is written here.
 */
export function AiAssist({ task, id, label, variant = "secondary", size = "sm", title }: Props) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [reply, setReply] = React.useState("");
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [proposalTitle, setProposalTitle] = React.useState("");

  async function run() {
    setOpen(true);
    setBusy(true);
    setError("");
    setReply("");
    setSteps([]);
    setProposalTitle("");
    try {
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reply?: string; steps?: Step[]; proposal?: { title?: string } | null; error?: string;
      };
      if (!res.ok) {
        setError(data.error || "The assistant is unavailable right now.");
        return;
      }
      setReply(data.reply ?? "");
      setSteps(data.steps ?? []);
      if (data.proposal?.title) setProposalTitle(data.proposal.title);
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => void run()}>
        <Sparkles className="h-3.5 w-3.5" /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? label}
        description="Grounded in your live practice data — read-only advice."
        wide
      >
        <div className="space-y-3">
          {busy ? (
            <div className="flex items-center gap-2 rounded-2xl bg-subtle px-4 py-6 text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the practice records…
            </div>
          ) : error ? (
            <p className="rounded-2xl bg-[#FBEAE7] px-3 py-2 text-xs font-semibold text-[#A33B2E]">{error}</p>
          ) : (
            <>
              <div className="rounded-2xl bg-subtle px-4 py-3 text-xs leading-relaxed text-ink">
                <Markdown text={reply} />
              </div>
              {steps.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {steps.map((s, i) => (
                    <span
                      key={`${s.tool}-${i}`}
                      className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted ring-1 ring-black/5"
                    >
                      {s.tool.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              ) : null}
              {proposalTitle ? (
                <p className="rounded-xl bg-gold-soft/60 px-3 py-2 text-[11px] text-muted">
                  Prepared for approval: <span className="font-semibold text-ink">{proposalTitle}</span>. Approve it from the AI palette (⌘J).
                </p>
              ) : null}
            </>
          )}
          <p className="flex items-start gap-1.5 rounded-xl bg-sage/50 px-3 py-2 text-[10px] leading-relaxed text-sage-ink">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
            Advisory only — the model cannot write records here. Verify statutory positions before acting.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}