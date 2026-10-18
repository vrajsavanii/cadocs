"use client";

import * as React from "react";
import { RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "./ui";

type BriefResponse = {
  brief?: string;
  source?: string;
  disclosure?: { enabled: boolean; provider: string | null; model: string | null; scope: string };
  error?: string;
};

/**
 * Practice brief line: shows the deterministic (always-correct) brief by
 * default and upgrades to the configured provider's rewrite when available.
 * The badge always discloses who processed it — "Local rules" when keyless.
 */
export function AiBriefLine({ initial, dark = false }: { initial: string; dark?: boolean }) {
  const [brief, setBrief] = React.useState(initial);
  const [source, setSource] = React.useState<string>("local");
  const [scope, setScope] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (showSpinner = true) => {
    if (showSpinner) setBusy(true);
    try {
      const res = await fetch("/api/ai/brief");
      const data = (await res.json()) as BriefResponse;
      if (res.ok && data.brief) {
        setBrief(data.brief);
        setSource(data.source || "local");
        setScope(data.disclosure?.scope ?? "");
      }
    } catch {
      // keep whatever we already show
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load(false);
  }, [load]);

  const isAi = source !== "practice-data" && source !== "local" && source !== "rules" && source !== "template";

  return (
    <div className={cn("rounded-2xl border p-4", dark ? "border-white/15 bg-white/10" : "border-black/5 bg-subtle")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]", dark ? "text-white/70" : "text-muted")}>
          <Sparkles className="h-3.5 w-3.5 text-gold" /> {isAi ? "AI brief" : "Brief from live data"}
        </span>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={busy}
          title="Regenerate brief"
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold transition disabled:opacity-60",
            dark ? "bg-white/10 text-white/80 hover:bg-white/15" : "bg-white text-muted ring-1 ring-black/5 hover:text-ink",
          )}
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} /> {isAi ? sourceLabel(source) : "Upgrade with AI"}
        </button>
      </div>
      <p className={cn("text-xs leading-relaxed", dark ? "text-white/85" : "text-ink")}>{busy ? "Thinking…" : brief}</p>
      {scope ? (
        <p className={cn("mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed", dark ? "text-white/60" : "text-muted")}>
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          {scope}
        </p>
      ) : null}
    </div>
  );
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter", nvidia: "NVIDIA" };
  return labels[source] ?? source ?? "AI";
}