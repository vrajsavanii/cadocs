/**
 * The practice agent.
 *
 * One entry point (`runAgent`) used by the ⌘J palette, the copilot page and
 * module assists. Two execution paths:
 *
 *   1. Provider path — bounded tool-calling loop (max 4 rounds / 8 calls).
 *      Reads execute inline; the first write becomes a pending ai_action.
 *   2. Keyless path — deterministic intent router over the SAME tool registry,
 *      including document-request/compliance/reminder proposals. This is what
 *      runs without an API key and what every offline test exercises.
 *
 * The model never executes a write itself and never sees PAN/GSTIN.
 */
import type { AuthUser } from "./types";
import {
  countAiCallsToday,
  countPendingAiActions,
  createAiAction,
  getAiAction,
  getSettings,
  listClients,
  logAiCall,
  recentAiCalls,
  type AiActionRow,
} from "./db";
import { aiDisclosure, chatWithTools, complete, type AgentMessage, type AgentToolCall } from "./ai";
import {
  getTool,
  outcomeForModel,
  providerSchemas,
  toolsForRole,
  type ToolDef,
  type ToolOutcome,
} from "./ai-tools";
import { agentSystemPrompt, assistPrompt, type AssistTask } from "./ai-prompts";
import { inr, prettyDate } from "./format";
import { buildInsights } from "./insights";

export const AI_DAILY_LIMIT = Math.max(5, Number(process.env.AI_DAILY_LIMIT) || 80);
const MAX_ROUNDS = 4;

/** Lowercase, strip punctuation and collapse whitespace for fuzzy name matching. */
function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DOC_STOPWORDS = new Set([
  "the", "a", "an", "of", "from", "for", "to", "please", "request", "document", "documents", "copy", "copies", "by",
]);

/** "request the bank statement for Sep 2026 from Mehta & Sons" → "bank statement for sep 2026". */
function cleanDocumentName(text: string, clientName: string): string {
  const escaped = clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = text
    .replace(new RegExp(escaped, "ig"), " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && DOC_STOPWORDS.has(words[0]!.toLowerCase())) words.shift();
  while (words.length && DOC_STOPWORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
  const name = words.join(" ").trim();
  if (!name) return "supporting document";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
const MAX_CALLS = 8;

export class AiQuotaError extends Error {
  constructor(message = "Daily AI budget reached. Resets at midnight.") {
    super(message);
    this.name = "AiQuotaError";
  }
}

export type AgentStep = { tool: string; kind: "read" | "write"; summary: string };

export type AgentProposal = {
  action_id: string;
  tool: string;
  title: string;
  args: Record<string, unknown>;
};

export type AgentResult = {
  reply: string;
  steps: AgentStep[];
  proposal: AgentProposal | null;
  source: string;
  provider: string | null;
  model: string | null;
  calls_today: number;
  limit: number;
  pending_actions: number;
};

type RunOpts = { user: AuthUser; message: string; action?: string; assist?: { task: AssistTask; id?: string } };

export async function runAgent({ user, message, action = "agent", assist }: RunOpts): Promise<AgentResult> {
  const started = Date.now();
  const callsToday = countAiCallsToday(user.user_id);
  if (callsToday >= AI_DAILY_LIMIT) throw new AiQuotaError();

  const tools = toolsForRole(user.role);
  const firmName = getSettings().firm_name ?? "the firm";
  const system = agentSystemPrompt({ user, firmName, today: new Date().toISOString().slice(0, 10) });

  const messages: AgentMessage[] = [{ role: "user", content: message }];
  const steps: AgentStep[] = [];
  let provider: string | null = null;
  let model: string | null = null;
  let rounds = 0;
  let toolCallCount = 0;

  for (rounds = 1; rounds <= MAX_ROUNDS; rounds++) {
    const turn = await chatWithTools({ system, messages, tools: providerSchemas(tools) });
    if (!turn) break; // no provider, failure, or malformed response → deterministic path

    provider = turn.provider;
    model = turn.model;

    if (turn.toolCalls.length === 0) {
      const reply = turn.content || "I could not produce an answer from the practice data.";
      return finish({
        reply,
        steps,
        proposal: null,
        source: turn.provider,
        provider,
        model,
        user,
        action,
        started,
        rounds,
        toolCalls: toolCallCount,
        status: "ok",
      });
    }

    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });
    const toolMessages: AgentMessage[] = [];

    for (const call of turn.toolCalls) {
      if (toolCallCount >= MAX_CALLS) break;
      toolCallCount += 1;
      const outcome = handleToolCall(call, user, tools);

      if (outcome.kind === "proposal") {
        messages.push(...toolMessages);
        const reply =
          (turn.content ? `${turn.content}\n\n` : "") +
          `**Prepared for approval:** ${outcome.proposal.title}.\nApprove it in the panel above to save the change.`;
        return finish({
          reply,
          steps: [...steps, { tool: outcome.proposal.tool, kind: "write", summary: outcome.proposal.title }],
          proposal: outcome.proposal,
          source: turn.provider,
          provider,
          model,
          user,
          action,
          started,
          rounds,
          toolCalls: toolCallCount,
          status: "proposal",
        });
      }

      steps.push({ tool: call.name, kind: "read", summary: outcome.summary });
      toolMessages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: outcome.content,
      });
    }

    messages.push(...toolMessages);
  }

  // Provider unusable (no key, error, or loop exhausted) → deterministic path.
  const fallback = assist
    ? deterministicAssist(user, assist.task, assist.id)
    : await deterministicRun(user, message);
  return finish({
    reply: fallback.reply,
    steps: fallback.steps,
    proposal: fallback.proposal,
    source: "practice-data",
    provider: null,
    model: null,
    user,
    action,
    started,
    rounds,
    toolCalls: fallback.steps.length,
    status: "fallback",
  });
}

type ToolCallOutcome =
  | { kind: "read"; summary: string; content: string }
  | { kind: "proposal"; proposal: AgentProposal };

/** Validates and executes one model tool call. Errors become tool results, never crashes. */
function handleToolCall(call: AgentToolCall, user: AuthUser, tools: ToolDef[]): ToolCallOutcome {
  const tool = getTool(call.name);
  if (!tool || !tools.some((t) => t.name === tool.name)) {
    return { kind: "read", summary: `${call.name} unavailable`, content: JSON.stringify({ error: "Tool not available for this role" }) };
  }

  let args: Record<string, unknown>;
  try {
    args = tool.validate(call.args);
  } catch (err) {
    return {
      kind: "read",
      summary: `${tool.name} rejected: ${(err as Error).message}`,
      content: JSON.stringify({ error: (err as Error).message }),
    };
  }

  if (tool.kind === "write") {
    const title = tool.preview?.(args) ?? `${tool.name} ${JSON.stringify(args)}`;
    const row = createAiAction({ user_id: user.user_id, tool: tool.name, args, title });
    return { kind: "proposal", proposal: { action_id: row.action_id, tool: tool.name, title, args } };
  }

  try {
    const outcome: ToolOutcome = tool.execute(args, { user });
    return { kind: "read", summary: outcome.summary, content: outcomeForModel(outcome) };
  } catch (err) {
    return {
      kind: "read",
      summary: `${tool.name} failed: ${(err as Error).message}`,
      content: JSON.stringify({ error: (err as Error).message }),
    };
  }
}

// ── Deterministic router (keyless / provider failure) ─────────────────────────

type FallbackResult = { reply: string; steps: AgentStep[]; proposal: AgentProposal | null };

async function deterministicRun(user: AuthUser, message: string): Promise<FallbackResult> {
  const q = message.toLowerCase().trim();
  const steps: AgentStep[] = [];
  const canWrite = user.role !== "article";

  const doRead = (name: string, raw: Record<string, unknown> = {}): ToolOutcome | null => {
    const tool = getTool(name);
    if (!tool) return null;
    try {
      const args = tool.validate(raw);
      const outcome = tool.execute(args, { user });
      steps.push({ tool: name, kind: "read", summary: outcome.summary });
      return outcome;
    } catch {
      return null;
    }
  };

  const propose = (name: string, raw: Record<string, unknown>): FallbackResult => {
    const tool = getTool(name);
    if (!tool) return { reply: "That action is not available.", steps, proposal: null };
    if (!canWrite) {
      return {
        reply: "Your role is read-only, so I can prepare advice but not create records. Ask a partner or manager to make this change.",
        steps,
        proposal: null,
      };
    }
    try {
      const args = tool.validate(raw);
      const title = tool.preview?.(args) ?? name;
      const row = createAiAction({ user_id: user.user_id, tool: name, args, title });
      steps.push({ tool: name, kind: "write", summary: title });
      return {
        reply: `**Prepared for approval:** ${title}.\n\nApprove it below to save the change, or reject it and nothing is written.`,
        steps,
        proposal: { action_id: row.action_id, tool: name, title, args },
      };
    } catch (err) {
      return { reply: `I could not prepare that: ${(err as Error).message}.`, steps, proposal: null };
    }
  };

  const findClientId = (query: string): { id: string; name: string } | null => {
    const tool = getTool("find_client");
    if (!tool) return null;
    try {
      const outcome = tool.execute(tool.validate({ query }), { user });
      const matches = (outcome.data?.matches ?? []) as Array<{ client_id: string; name: string }>;
      return matches[0] ? { id: matches[0].client_id, name: matches[0].name } : null;
    } catch {
      return null;
    }
  };

  /**
   * Resolve a client from free text. Preposition-based extraction is fragile
   * ("bank statement for Sep 2026 from Mehta & Sons"), so we also scan the
   * utterance for the longest known client name it contains.
   */
  const resolveClient = (text: string): { id: string; name: string } | null => {
    const direct = findClientId(text.trim());
    if (direct) return direct;
    const haystack = normaliseName(text);
    if (!haystack) return null;
    const hit = listClients()
      .map((c) => ({ client: c, key: normaliseName(c.name) }))
      .filter((x) => x.key && haystack.includes(x.key))
      .sort((a, b) => b.key.length - a.key.length)[0];
    return hit ? { id: hit.client.client_id, name: hit.client.name } : null;
  };

  // ── Write intents ──────────────────────────────────────────────────────────
  // Match the original casing so document names keep acronyms ("TDS", "Q3").
  const docIntent = message.trim().match(/^(?:please\s+)?request(?:\s+a|\s+an)?(?:\s+document)?\s+["“]?(.+)$/i);
  if (docIntent) {
    const body = docIntent[1]!.replace(/["”]\s*$/, "").trim();
    const client = resolveClient(body);
    if (!client) {
      return {
        reply: `I couldn't find a client in "${body}". Name the client exactly as it appears in Clients — e.g. \`request bank statement for Sep 2026 from Mehta & Sons LLP\`.`,
        steps,
        proposal: null,
      };
    }
    return propose("request_document", {
      client_id: client.id,
      document_name: cleanDocumentName(body, client.name),
      notes: "",
    });
  }

  const complianceIntent = q.match(
    /^(?:please\s+)?create\s+(?:a\s+)?(gstr[-\s]?[139]b?|gstr[-\s]?1|itr|tds|tax audit|roc|mgt[-\s]?7|aoc[-\s]?4)\s+(?:for|of)\s+(.+?)(?:\s+due\s+(\d{4}-\d{2}-\d{2}))?$/i,
  );
  if (complianceIntent) {
    const rawType = complianceIntent[1]!.toLowerCase();
    const clientQuery = complianceIntent[2]!.trim();
    const due = complianceIntent[3];
    if (!due) {
      return {
        reply: "Tell me the due date so the task is created accurately — for example: `create GSTR-3B for Sharma Textiles due 2026-11-20`.",
        steps,
        proposal: null,
      };
    }
    const typeMap: Record<string, string> = {
      "gstr-1": "GST Filing (GSTR-1)",
      gstr1: "GST Filing (GSTR-1)",
      "gstr-3b": "GST Filing (GSTR-3B)",
      gstr3b: "GST Filing (GSTR-3B)",
      "gstr-9": "GST Filing (GSTR-9)",
      gstr9: "GST Filing (GSTR-9)",
      itr: "ITR Filing",
      tds: "TDS Payment (26Q)",
      "tax audit": "Tax Audit Report",
      roc: "ROC Annual Filing (AOC-4)",
      "mgt-7": "ROC Annual Filing (MGT-7)",
      mgt7: "ROC Annual Filing (MGT-7)",
      "aoc-4": "ROC Annual Filing (AOC-4)",
      aoc4: "ROC Annual Filing (AOC-4)",
    };
    const complianceType = typeMap[rawType.replace(/\s+/g, " ")] ?? typeMap[rawType.replace(/[\s-]/g, "")];
    const client = resolveClient(clientQuery) ?? resolveClient(q);
    if (!client) return { reply: `I couldn't find a client matching "${clientQuery}".`, steps, proposal: null };
    if (!complianceType) return { reply: `I don't recognise that filing type. Supported: GSTR-1/3B/9, ITR, TDS, Tax Audit, ROC (AOC-4/MGT-7).`, steps, proposal: null };
    const period = new Date(`${due}T12:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    return propose("create_compliance_task", {
      client_id: client.id,
      compliance_type: complianceType,
      period,
      due_date: due,
    });
  }

  const remindIntent = q.match(/^(?:please\s+)?remind\s+(.+?)(?:\s+about\s+(.+))?$/i);
  if (remindIntent) {
    const clientQuery = remindIntent[1]!.trim();
    const about = (remindIntent[2] ?? "the pending information").trim();
    const client = resolveClient(clientQuery) ?? resolveClient(q);
    if (!client) return { reply: `I couldn't find a client matching "${clientQuery}".`, steps, proposal: null };
    return propose("log_reminder", {
      client_id: client.id,
      channel: "WhatsApp",
      body: `Dear ${client.name},\n\nA gentle reminder regarding ${about}. Kindly share it at the earliest so we can complete your filing on time.\n\nRegards,\n${getSettings().firm_name ?? "the firm"}`,
    });
  }

  // ── Read intents ───────────────────────────────────────────────────────────
  const overview = doRead("practice_overview");

  if (/\b(plan|week|priorit|today)\b/.test(q)) {
    const deadlines = doRead("list_deadlines", { days: 7, limit: 8 });
    const docs = doRead("list_pending_documents", { older_than_days: 3 });
    const fees = doRead("list_overdue_invoices", { min_days: 0 });
    const tasks = (deadlines?.data?.tasks ?? []) as Array<{ client: string; type: string; days_until: number; due: string }>;
    const pending = (docs?.data?.documents ?? []) as Array<{ client: string; document: string; days_waiting: number }>;
    const overdue = (fees?.data?.invoices ?? []) as Array<{ client: string; balance: number; days_late: number }>;
    const lines = ["**This week, in order**", ""];
    tasks.slice(0, 5).forEach((t, i) => {
      lines.push(`${i + 1}. ${t.client} — ${t.type}, ${t.days_until < 0 ? `${Math.abs(t.days_until)} days overdue` : `due in ${t.days_until} days`} (${prettyDate(t.due)})`);
    });
    if (pending.length) lines.push("", `**Document blockers:** ${pending.slice(0, 3).map((d) => `${d.client} (${d.document}, ${d.days_waiting}d)`).join("; ")}`);
    if (overdue.length) lines.push("", `**Money:** chase ${overdue[0]!.client} first — ${inr(overdue[0]!.balance)} is ${overdue[0]!.days_late} days late.`);
    lines.push("", "**Do now:** clear the most overdue filing, then send one consolidated reminder round.");
    return { reply: lines.join("\n"), steps, proposal: null };
  }

  if (/overdue|late|penalt|deadline/.test(q)) {
    const deadlines = doRead("list_deadlines", { days: 0, limit: 10 });
    const fees = doRead("list_overdue_invoices");
    const tasks = (deadlines?.data?.tasks ?? []) as Array<{ client: string; type: string; days_until: number; due: string }>;
    const overdue = (fees?.data?.invoices ?? []) as Array<{ client: string; balance: number; days_late: number; invoice: string }>;
    const total = Number(fees?.data?.total_overdue ?? 0);
    return {
      reply: [
        `**${tasks.length} filings past due**`,
        ...tasks.slice(0, 6).map((t) => `• ${t.client} — ${t.type} (${Math.abs(t.days_until)} days late, due ${prettyDate(t.due)})`),
        "",
        `**${overdue.length} invoices overdue, ${inr(total)} at risk**`,
        ...overdue.slice(0, 4).map((i) => `• ${i.client} — ${inr(i.balance)} · ${i.days_late} days late`),
      ].join("\n"),
      steps,
      proposal: null,
    };
  }

  if (/document|waiting|collect|upload|chase/.test(q)) {
    const docs = doRead("list_pending_documents", { older_than_days: 0 });
    const rows = (docs?.data?.documents ?? []) as Array<{ client: string; document: string; days_waiting: number }>;
    return {
      reply: rows.length
        ? [`**${rows.length} document requests pending**`, ...rows.slice(0, 8).map((d) => `• ${d.client} — ${d.document} (${d.days_waiting}d)`), "", "Oldest first: chase these before the next filing deadline."].join("\n")
        : "No documents are pending — every request has been received.",
      steps,
      proposal: null,
    };
  }

  if (/owe|outstanding|receiv|fees|money|collect|payment/.test(q)) {
    const fees = doRead("list_overdue_invoices");
    const summary = doRead("revenue_summary");
    const rows = (fees?.data?.invoices ?? []) as Array<{ client: string; balance: number; days_late: number }>;
    const data = summary?.data as { billed?: number; collected?: number; outstanding?: number } | undefined;
    return {
      reply: [
        data ? `**Billed ${inr(data.billed ?? 0)} · collected ${inr(data.collected ?? 0)} · outstanding ${inr(data.outstanding ?? 0)}**` : "**Fees**",
        ...rows.slice(0, 6).map((r) => `• ${r.client} — ${inr(r.balance)}, ${r.days_late} days late`),
        "",
        rows.length ? "Start with the oldest balance; a single firm reminder usually clears the top bucket." : "No overdue invoices.",
      ].join("\n"),
      steps,
      proposal: null,
    };
  }

  if (/util|hour|timesheet|billable/.test(q)) {
    const util = doRead("utilization_summary");
    const data = util?.data as { total_hours?: number; billable_hours?: number; staff?: Array<{ name: string; hours: number; billable_pct: number; clients: number }> } | undefined;
    const staff = data?.staff ?? [];
    const pct = data && data.total_hours ? Math.round(((data.billable_hours ?? 0) / data.total_hours) * 100) : 0;
    return {
      reply: [
        `**${(data?.total_hours ?? 0).toFixed(1)} hours logged · ${pct}% billable**`,
        ...staff.map((s) => `• ${s.name} — ${s.hours}h, ${s.billable_pct}% billable, ${s.clients} clients`),
        "",
        pct < 60 ? "Non-billable share is high; review what is being logged against internal work." : "Billable share is healthy.",
      ].join("\n"),
      steps,
      proposal: null,
    };
  }

  if (/lead|pipeline|propos|prospect/.test(q)) {
    const pipeline = doRead("pipeline_summary");
    const data = pipeline?.data as { stages?: Record<string, number>; hot_leads?: Array<{ name: string; company: string; status: string; score: number }>; proposals_sent?: number } | undefined;
    return {
      reply: [
        `**Pipeline:** ${Object.entries(data?.stages ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
        `Proposals sent: ${data?.proposals_sent ?? 0}`,
        ...(data?.hot_leads ?? []).map((l) => `• ${l.name} (${l.company || "—"}) — ${l.status}, score ${l.score}`),
      ].join("\n"),
      steps,
      proposal: null,
    };
  }

  const clientQuery =
    q.match(/(?:about|summar(?:y|ise|ize)|for)\s+(.+)$/)?.[1]?.trim() ??
    q.match(/client\s+(.+)$/)?.[1]?.trim();

  if (clientQuery) {
    const client = findClientId(clientQuery);
    if (client) {
      const detail = doRead("client_360", { client_id: client.id });
      const d = detail?.data as
        | {
            name: string; totals: { billed: number; collected: number; outstanding: number; overdue: number };
            open_compliance: Array<{ type: string; due: string; status: string }>;
            pending_documents: Array<{ document: string; days_waiting: number }>;
            last_reminder: { channel: string; date: string } | null;
          }
        | undefined;
      if (d) {
        return {
          reply: [
            `**${d.name}**`,
            `• Billed ${inr(d.totals.billed)}, collected ${inr(d.totals.collected)}, outstanding ${inr(d.totals.outstanding)}`,
            `• Open filings: ${d.open_compliance.length ? d.open_compliance.map((c) => `${c.type} (${prettyDate(c.due)})`).join("; ") : "none"}`,
            `• Pending documents: ${d.pending_documents.length ? d.pending_documents.map((p) => `${p.document} (${p.days_waiting}d)`).join("; ") : "none"}`,
            d.last_reminder ? `• Last reminder: ${d.last_reminder.channel} on ${prettyDate(d.last_reminder.date)}` : "• No reminder logged yet",
            "",
            "**Next action:** clear the open filings, then chase the oldest pending document.",
          ].join("\n"),
          steps,
          proposal: null,
        };
      }
    }
  }

  const insights = buildInsights();
  return {
    reply: [
      insights[0] ? `**${insights[0].title}** — ${insights[0].body}` : overview?.summary ?? "Practice snapshot ready.",
      "",
      "Ask me to plan your week, show overdue work, summarise a client, or request a document.",
      insights[1] ? `Also: ${insights[1].title.toLowerCase()}.` : "",
    ].filter(Boolean).join("\n"),
    steps,
    proposal: null,
  };
}

// ── Result plumbing ───────────────────────────────────────────────────────────

function finish(input: {
  reply: string;
  steps: AgentStep[];
  proposal: AgentProposal | null;
  source: string;
  provider: string | null;
  model: string | null;
  user: AuthUser;
  action: string;
  started: number;
  rounds: number;
  toolCalls: number;
  status: string;
}): AgentResult {
  const latency = Date.now() - input.started;
  logAiCall({
    user_id: input.user.user_id,
    action: input.action,
    provider: input.provider,
    model: input.model,
    tool_names: input.steps.map((s) => s.tool),
    tool_calls: input.toolCalls,
    rounds: input.rounds,
    latency_ms: latency,
    status: input.status,
    detail: input.proposal ? `proposal:${input.proposal.tool}` : "",
  });

  return {
    reply: input.reply,
    steps: input.steps,
    proposal: input.proposal,
    source: input.source,
    provider: input.provider,
    model: input.model,
    calls_today: countAiCallsToday(input.user.user_id),
    limit: AI_DAILY_LIMIT,
    pending_actions: countPendingAiActions(input.user.user_id),
  };
}

// ── Assist entry point ────────────────────────────────────────────────────────

export async function runAssist(opts: { user: AuthUser; task: AssistTask; id?: string }): Promise<AgentResult> {
  return runAgent({
    user: opts.user,
    message: assistPrompt(opts.task, opts.id),
    action: `assist:${opts.task}`,
    assist: { task: opts.task, id: opts.id },
  });
}

// ── Deterministic module assists ─────────────────────────────────────────────

/** A module assist always answers ITS question, even with no provider key. */
function runReadTool(
  name: string,
  args: Record<string, unknown>,
  user: AuthUser,
  steps: AgentStep[],
): ToolOutcome | null {
  const tool = getTool(name);
  if (!tool || !tool.roles.includes(user.role)) return null;
  try {
    const outcome = tool.execute(tool.validate(args), { user });
    steps.push({ tool: name, kind: "read", summary: outcome.summary });
    return outcome;
  } catch {
    return null;
  }
}

function deterministicAssist(user: AuthUser, task: AssistTask, id?: string): FallbackResult {
  const steps: AgentStep[] = [];

  if (task === "client_summary") {
    const outcome = runReadTool("client_360", { client_id: id ?? "" }, user, steps);
    if (!outcome) {
      return { reply: "I couldn't load that client from the practice data. Open the client again from the Clients list.", steps, proposal: null };
    }
    type ClientData = {
      name: string; entity: string; city: string;
      totals: { billed: number; collected: number; outstanding: number };
      open_compliance: Array<{ type: string; period: string; due: string; status: string }>;
      pending_documents: Array<{ document: string; requested: string; days_waiting: number }>;
      open_invoices: Array<{ invoice: string; balance: number; due: string; status: string; days_late: number }>;
    };
    const d = outcome.data as unknown as ClientData;
    const lines: string[] = [`**${d.name}** — ${d.entity}${d.city ? `, ${d.city}` : ""}`];
    lines.push(`• Billed ${inr(d.totals.billed)}, collected ${inr(d.totals.collected)}, outstanding ${inr(d.totals.outstanding)}.`);
    if (d.open_compliance.length) {
      const overdue = d.open_compliance.filter((c) => new Date(c.due).getTime() < Date.now()).length;
      lines.push(`• Open filings: ${d.open_compliance.slice(0, 3).map((c) => `${c.type} (${prettyDate(c.due)})`).join("; ")}${overdue ? ` — ${overdue} overdue` : ""}.`);
    } else {
      lines.push("• No open filings.");
    }
    if (d.pending_documents.length) {
      const oldest = d.pending_documents[0]!;
      lines.push(`• Waiting on ${d.pending_documents.length} document(s); oldest: ${oldest.document} (${oldest.days_waiting}d).`);
    } else {
      lines.push("• No pending documents.");
    }
    const openInvoices = d.open_invoices.filter((i) => i.balance > 0);
    if (openInvoices.length) {
      const balance = openInvoices.reduce((s, i) => s + i.balance, 0);
      const oldestLate = Math.max(...openInvoices.map((i) => i.days_late));
      lines.push(`• ${openInvoices.length} open invoice(s) worth ${inr(balance)}${oldestLate > 0 ? `, oldest ${oldestLate} days late` : ""}.`);
    } else {
      lines.push("• No open invoices — the account is settled.");
    }
    const overdueFiling = d.open_compliance.find((c) => new Date(c.due).getTime() < Date.now());
    const nextAction = overdueFiling
      ? `close the overdue ${overdueFiling.type} filing first, then confirm documents.`
      : oldestLate(d.open_invoices) > 0
        ? `chase the ${inr(openInvoices[0]!.balance)} balance on ${openInvoices[0]!.invoice} before the call.`
        : d.pending_documents.length
          ? `chase ${d.pending_documents[0]!.document} so the next filing isn't held up.`
          : "nothing urgent — use the call to scope the next service line.";
    lines.push(`• Next action: ${nextAction}`);
    return { reply: lines.join("\n"), steps, proposal: null };
  }

  if (task === "week_plan") {
    const tasks = (runReadTool("list_deadlines", { days: 7, limit: 8 }, user, steps)?.data as
      | { tasks: Array<{ client: string; type: string; due: string; status: string; days_until: number }> }
      | undefined)?.tasks ?? [];
    const invoices = (runReadTool("list_overdue_invoices", {}, user, steps)?.data as
      | { invoices: Array<{ client: string; invoice: string; balance: number; days_late: number }>; total_overdue: number }
      | undefined);
    const docs = (runReadTool("list_pending_documents", { older_than_days: 5 }, user, steps)?.data as
      | { documents: Array<{ client: string; document: string; days_waiting: number }> }
      | undefined)?.documents ?? [];

    const lines: string[] = ["**This week, in order**"];
    let n = 1;
    for (const t of tasks.filter((x) => x.days_until < 0).slice(0, 3)) {
      lines.push(`${n++}. ${t.client} — ${t.type}, ${Math.abs(t.days_until)} days overdue (${prettyDate(t.due)})`);
    }
    for (const t of tasks.filter((x) => x.days_until >= 0).slice(0, 3)) {
      lines.push(`${n++}. ${t.client} — ${t.type}, due ${prettyDate(t.due)}`);
    }
    if (invoices?.invoices.length) {
      const top = invoices.invoices[0]!;
      lines.push(`${n++}. Recover fees: ${top.client} owes ${inr(top.balance)} (${top.days_late} days late) across ${invoices.invoices.length} overdue invoice(s) worth ${inr(invoices.total_overdue)}.`);
    }
    if (docs.length) {
      const top = docs[0]!;
      lines.push(`${n++}. Unblock documents: ${docs.length} waiting, oldest ${top.client} — ${top.document} (${top.days_waiting}d).`);
    }
    if (n === 1) {
      lines.push("Nothing overdue or due this week — a good window for pipeline and cleanup work.");
    } else {
      lines.push("");
      lines.push(`Start today with #1. ${tasks.some((t) => t.days_until < 0) ? "Overdue statutory items carry penalty exposure." : "Deadlines first, then money."}`);
    }
    return { reply: lines.join("\n"), steps, proposal: null };
  }

  if (task === "collection_plan") {
    const invoices = (runReadTool("list_overdue_invoices", {}, user, steps)?.data as
      | { invoices: Array<{ client: string; invoice: string; balance: number; due: string; days_late: number }>; total_overdue: number }
      | undefined);
    const revenue = runReadTool("revenue_summary", {}, user, steps)?.data as
      | { billed: number; collected: number; outstanding: number }
      | undefined;
    if (!invoices?.invoices.length) {
      return { reply: "No invoice is past due right now — nothing to collect. Keep the cycle clean by billing on completion.", steps, proposal: null };
    }
    const lines: string[] = ["**Collection plan**"];
    if (revenue) {
      lines.push(`Billed ${inr(revenue.billed)}, collected ${inr(revenue.collected)}, outstanding ${inr(revenue.outstanding)}.`);
    }
    lines.push("");
    for (const inv of invoices.invoices.slice(0, 5)) {
      const tone = inv.days_late > 30 ? "final notice" : inv.days_late > 15 ? "firm follow-up" : "gentle reminder";
      lines.push(`• ${inv.client} — ${inr(inv.balance)} on ${inv.invoice}, ${inv.days_late} days late → ${tone}.`);
    }
    const first = invoices.invoices[0]!;
    lines.push("");
    lines.push(`Start with ${first.client}: ${inr(first.balance)} at ${first.days_late} days is the largest recovery you can make today.`);
    return { reply: lines.join("\n"), steps, proposal: null };
  }

  if (task === "utilization_review") {
    const data = runReadTool("utilization_summary", {}, user, steps)?.data as
      | { total_hours: number; billable_hours: number; staff: Array<{ name: string; hours: number; billable_pct: number; approved_hours: number }> }
      | undefined;
    if (!data || !data.staff.length) {
      return { reply: "No timesheets logged yet, so utilization can't be measured. Ask the team to log this week before reviewing.", steps, proposal: null };
    }
    const pct = data.total_hours > 0 ? Math.round((data.billable_hours / data.total_hours) * 100) : 0;
    const lines = [`**Utilization** — ${data.total_hours.toFixed(1)}h logged, ${pct}% billable.`];
    for (const s of data.staff.slice(0, 4)) {
      lines.push(`• ${s.name} — ${s.hours.toFixed(1)}h, ${s.billable_pct}% billable, ${s.approved_hours.toFixed(1)}h approved.`);
    }
    const lowest = [...data.staff].sort((a, b) => a.billable_pct - b.billable_pct)[0]!;
    lines.push("");
    lines.push(pct < 60
      ? `Staffing action: billable share is low — move ${lowest.name}'s non-billable time onto filed client work next week.`
      : `Staffing action: protect the billable mix — ${lowest.name} is at ${lowest.billable_pct}%; pair them with chargeable work.`);
    return { reply: lines.join("\n"), steps, proposal: null };
  }

  // notice_draft
  const outcome = runReadTool("get_notice", { notice_id: id ?? "" }, user, steps);
  if (!outcome) {
    return { reply: "I couldn't load that notice. Open it from the Notices list and try again.", steps, proposal: null };
  }
  const n = outcome.data as unknown as {
    client: string; type: string; portal: string; received: string; deadline: string;
    reference: string; amount: number | null; status: string; notes: string;
  };
  const lines = [
    `**Draft reply outline — ${n.type}**`,
    `${n.client} · ${n.portal || "portal"} · reference ${n.reference || "—"} · response due ${prettyDate(n.deadline)}.`,
    "",
    `1. Acknowledge the ${n.type}, quote reference ${n.reference || "—"} and confirm receipt on ${prettyDate(n.received)}.`,
    `2. State the facts on record only${n.amount ? ` — the demand is ${inr(n.amount)}` : ""}. Do not concede points not yet verified.`,
    "3. Attach: the return/statement under reference, reconciliation, and the supporting invoices or challans.",
    "4. Legal basis: cite the specific section and circular the CA confirms applies — leave this for review, do not guess.",
    `5. Close with the requested relief and file before ${prettyDate(n.deadline)}; keep proof of submission.${n.notes ? ` Note on record: ${n.notes}` : ""}`,
    "",
    "_Outline only — a CA must verify figures and the legal position before filing._",
  ];
  return { reply: lines.join("\n"), steps, proposal: null };
}

function oldestLate(invoices: Array<{ days_late: number }>): number {
  return invoices.length ? Math.max(...invoices.map((i) => i.days_late)) : 0;
}

// ── Simple summary path for module panels (no tools) ─────────────────────────

export async function runSummary(opts: { user: AuthUser; prompt: string; action: string }): Promise<{ text: string; source: string }> {
  const result = await complete({
    system:
      "You write concise, factual summaries for an Indian CA firm. Never invent numbers; if data is missing, say so. Max 120 words.",
    user: opts.prompt,
    maxTokens: 300,
    temperature: 0.3,
  });
  logAiCall({
    user_id: opts.user.user_id,
    action: opts.action,
    provider: result?.provider ?? null,
    model: result?.model ?? null,
    status: result ? "ok" : "fallback",
  });
  return { text: result?.text ?? "", source: result?.provider ?? "practice-data" };
}

// ── Usage snapshot ────────────────────────────────────────────────────────────

export function usageSnapshot(user: AuthUser) {
  const disclosure = aiDisclosure();
  return {
    calls_today: countAiCallsToday(user.user_id),
    limit: AI_DAILY_LIMIT,
    pending_actions: countPendingAiActions(user.user_id),
    provider: disclosure.provider,
    model: disclosure.model,
    enabled: disclosure.enabled,
    scope: disclosure.scope,
    recent: recentAiCalls(user.user_id, 8).map((c) => ({
      action: c.action,
      tools: c.tool_names ? c.tool_names.split(",") : [],
      status: c.status,
      latency_ms: c.latency_ms,
      provider: c.provider,
      created_at: c.created_at,
    })),
  };
}

/** Approve/reject execution lives in the route; this helper loads + checks ownership. */
export function pendingActionFor(user: AuthUser, actionId: string): AiActionRow | null {
  const row = getAiAction(actionId);
  if (!row) return null;
  if (row.user_id !== user.user_id && user.role !== "partner") return null;
  return row;
}