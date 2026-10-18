"use client";

import * as React from "react";
import { Activity, CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react";

type Recent = { action: string; tools: string[]; status: string; latency_ms: number; provider: string | null; created_at: string };
type Usage = {
  calls_today: number; limit: number; pending_actions: number;
  provider: string | null; model: string | null; enabled: boolean;
  recent: Recent[];
};

/** AI usage, quota and audit snapshot — visible to every role, read-only. */
export function AiUsageStrip() {
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    fetch("/api/ai/usage")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((data: Usage) => {
        if (alive) setUsage(data);
      })
      .catch(() => {
        if (alive) setError("Usage unavailable");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="text-[10px] font-semibold text-muted">{error}</p>;
  if (!usage) return <p className="text-[10px] text-muted">Loading AI usage…</p>;

  const pct = Math.min(100, Math.round((usage.calls_today / Math.max(1, usage.limit)) * 100));

  return (
    <div className="mt-3 rounded-2xl border border-black/5 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold text-muted">
        <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" /> {usage.calls_today}/{usage.limit} AI calls today</span>
        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {usage.provider ?? "local rules"}</span>
        <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {usage.pending_actions} awaiting approval</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5">
        <div className="h-full rounded-full bg-green transition-all" style={{ width: `${pct}%` }} />
      </div>
      {usage.recent.length > 0 ? (
        <div className="mt-2 space-y-1">
          {usage.recent.slice(0, 4).map((r, i) => (
            <div key={`${r.created_at}-${i}`} className="flex items-center gap-1.5 text-[10px] text-muted">
              {r.status === "ok" || r.status === "proposal" ? (
                <CheckCircle2 className="h-3 w-3 text-green" />
              ) : r.status === "fallback" ? (
                <Clock3 className="h-3 w-3 text-gold" />
              ) : (
                <XCircle className="h-3 w-3 text-[#A33B2E]" />
              )}
              <span className="truncate">{r.action}{r.tools.length ? ` · ${r.tools.join(", ")}` : ""}</span>
              <span className="ml-auto shrink-0">{r.latency_ms} ms</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}