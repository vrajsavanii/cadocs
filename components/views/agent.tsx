"use client";

import * as React from "react";
import { ArrowUp, Bot, Sparkles, User } from "lucide-react";
import { Badge, Button, PageHeader } from "../ui";
import { cn } from "../ui";
import { Markdown } from "../markdown";

type Message = { id: number; role: "assistant" | "user"; content: string };

export function AgentView({
  brief,
  kpis,
}: {
  brief: string;
  kpis: { clients: number; dueWeek: number; overdueFees: string; pendingDocs: number };
}) {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      content: `**Morning brief**\n${brief}\n\nAsk me about deadlines, fee recovery, pending documents, or the lead pipeline.`,
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [disclosure, setDisclosure] = React.useState<{
    provider: string | null; model: string | null; enabled: boolean; scope: string;
  } | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const suggestions = [
    "What is overdue right now?",
    "Who owes us fees the longest?",
    "Which documents are we waiting on?",
    "Summarise the lead pipeline",
  ];

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: message }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as {
        reply?: string; error?: string;
        disclosure?: { provider: string | null; model: string | null; enabled: boolean; scope: string } | null;
      };
      if (data.disclosure && typeof data.disclosure === "object") setDisclosure(data.disclosure);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: data.reply || data.error || "I couldn't process that. Try again.",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 2, role: "assistant", content: "The copilot is unreachable right now. Check that the server is running." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Practice intelligence"
        title="AI copilot"
        description="A partner-level assistant wired into live compliance, billing and client data."
      >
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="sage">{kpis.clients} clients</Badge>
          <Badge tone="amber">{kpis.dueWeek} due this week</Badge>
          <Badge tone="red">{kpis.overdueFees} overdue</Badge>
          <Badge tone="blue">{kpis.pendingDocs} docs pending</Badge>
        </div>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="card flex h-[calc(100dvh-240px)] min-h-[520px] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-green text-white"><Sparkles className="h-4 w-4" /></span>
            <div>
              <p className="text-xs font-extrabold text-ink">Practice copilot</p>
              <p className="text-[10px] text-muted">Grounded in your live practice data</p>
            </div>
            <span
              className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-muted"
              title={disclosure?.scope || "Answers use your live practice data; only aggregate facts are sent to the AI provider."}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#3E8A52]" />
              {disclosure
                ? disclosure.provider
                  ? `${disclosure.provider} ${disclosure.model ?? ""} · on`
                  : "Local rules · no AI provider configured"
                : "Grounded in live data"}
            </span>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {messages.map((m) => (
              <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "")}>
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-gold-soft text-gold" : "bg-sage text-sage-ink")}>
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </span>
                <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed", m.role === "user" ? "bg-green text-white" : "bg-subtle text-ink")}>
                  <Markdown text={m.content} />
                </div>
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sage text-sage-ink"><Bot className="h-3.5 w-3.5" /></span>
                <div className="flex gap-1 rounded-2xl bg-subtle px-3.5 py-3">
                  {[0, 150, 300].map((delay) => (
                    <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-black/5 p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-muted ring-1 ring-black/5 transition hover:text-ink hover:ring-black/15"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); void send(input); }}
              className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-1.5 focus-within:border-green/40 focus-within:ring-2 focus-within:ring-green/10"
            >
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Ask about deadlines, fees, documents or leads…"
                className="max-h-24 flex-1 resize-none bg-transparent px-2.5 py-2 text-xs text-ink outline-none placeholder:text-muted/70"
              />
              <Button type="submit" size="icon" loading={loading} disabled={!input.trim()} aria-label="Send">
                {!loading ? <ArrowUp className="h-4 w-4" /> : null}
              </Button>
            </form>
          </div>
        </div>

        <div className="space-y-3">
          <div className="card p-4">
            <h2 className="text-xs font-extrabold text-ink">Live context</h2>
            <p className="text-[10px] text-muted">Every answer is grounded in these numbers</p>
            <dl className="mt-3 space-y-2 text-[11px]">
              {[
                ["Active clients", kpis.clients],
                ["Filings due this week", kpis.dueWeek],
                ["Overdue fees", kpis.overdueFees],
                ["Documents pending", kpis.pendingDocs],
                
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between border-b border-black/5 pb-1.5 last:border-0">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-bold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="card bg-sage/60 p-4">
            <p className="text-[11px] font-bold text-sage-ink">Partner tip</p>
            <p className="mt-1 text-[10px] leading-relaxed text-sage-ink/80">
              Ask “what is overdue right now?” every morning. The copilot reads deadlines and invoices directly from the practice database, so nothing is stale.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

