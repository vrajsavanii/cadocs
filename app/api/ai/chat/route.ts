import { getDashboard, listClients, listCompliance, listDocuments, listInvoices, listLeads } from "@/lib/db";
import { getSettings } from "@/lib/db";
import { handle, ok, readBody, str } from "@/lib/api";
import { inr, prettyDate } from "@/lib/format";
import { aiDisclosure, complete } from "@/lib/ai";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

function buildContext() {
  const clients = listClients();
  const compliance = listCompliance().filter((c) => c.status !== "Filed");
  const invoices = listInvoices().filter((i) => i.status !== "Paid");
  const documents = listDocuments().filter((d) => d.status === "Pending");
  const leads = listLeads().filter((l) => !["Won", "Lost"].includes(l.status));
  const stats = getDashboard().kpis;

  return [
    `Firm: ${getSettings().firm_name} (${clients.length} clients)`,
    `KPIs: ${stats.overdueCompliance} overdue filings, ${stats.pendingDocuments} pending documents, ${inr(stats.overdueFees)} overdue fees, collection rate ${stats.collectionRate}%.`,
    `Next deadlines: ${compliance.slice(0, 5).map((c) => `${c.client_name} — ${c.compliance_type} on ${prettyDate(c.due_date)} (${c.status})`).join("; ")}`,
    `Overdue invoices: ${invoices.filter((i) => i.status === "Overdue").slice(0, 5).map((i) => `${i.client_name} ${inr(i.total_amount)} since ${prettyDate(i.due_date)}`).join("; ")}`,
    `Pending documents: ${documents.slice(0, 6).map((d) => `${d.client_name} — ${d.document_name}`).join("; ")}`,
    `Open leads: ${leads.slice(0, 6).map((l) => `${l.name} (${l.company_name}) ${l.category}/${l.status}, score ${l.lead_score}`).join("; ")}`,
  ].join("\n");
}

function fallbackReply(message: string): string {
  const q = message.toLowerCase();
  const clients = listClients();
  const compliance = listCompliance().filter((c) => c.status !== "Filed");
  const invoices = listInvoices().filter((i) => i.status !== "Paid");
  const documents = listDocuments().filter((d) => d.status === "Pending");
  const leads = listLeads().filter((l) => !["Won", "Lost"].includes(l.status));
  const stats = getDashboard().kpis;

  if (/overdue|penalt|late/.test(q)) {
    return [
      `**Overdue exposure**`,
      `• ${stats.overdueCompliance} compliance tasks are past due — clear these first to stop penalty accrual.`,
      `• ${inr(stats.overdueFees)} is stuck in ${invoices.filter((i) => i.status === "Overdue").length} overdue invoices.`,
      compliance.filter((c) => c.status === "Overdue").slice(0, 3).map((c) => `• ${c.client_name}: ${c.compliance_type} (${prettyDate(c.due_date)})`).join("\n"),
      ``,
      `Suggested next step: send a single consolidated reminder for the top 3 overdue clients today.`,
    ].filter(Boolean).join("\n");
  }

  if (/compliance|filing|gst|tds|deadline|due/.test(q)) {
    return [
      `**Compliance desk** — ${compliance.length} open items, ${stats.complianceDueThisWeek} due within 7 days.`,
      ...compliance.slice(0, 5).map((c) => `• ${c.client_name} — ${c.compliance_type}, ${prettyDate(c.due_date)} (${c.status})`),
      ``,
      `I can mark items filed or create a follow-up task for any of these.`,
    ].join("\n");
  }

  if (/invoice|fee|payment|collect|revenue|money/.test(q)) {
    return [
      `**Fee recovery**`,
      `• Billed: ${inr(stats.totalBilled)}`,
      `• Collected: ${inr(stats.totalCollected)} (${stats.collectionRate}%)`,
      `• Outstanding: ${inr(stats.totalBilled - stats.totalCollected)}, of which ${inr(stats.overdueFees)} is overdue.`,
      ...invoices.slice(0, 4).map((i) => `• ${i.client_name} — ${inr(i.total_amount)} due ${prettyDate(i.due_date)} (${i.status})`),
    ].join("\n");
  }

  if (/lead|pipeline|prospect|crm|convert/.test(q)) {
    return [
      `**Lead pipeline** — ${leads.length} open leads, ${stats.hotLeads} marked hot.`,
      ...leads.slice(0, 5).map((l) => `• ${l.name} (${l.company_name}) — ${l.category}, ${l.status}, score ${l.lead_score}`),
      ``,
      `Highest-value next action: follow up on qualified leads with a proposal this week.`,
    ].join("\n");
  }

  if (/document|pending|collect|upload/.test(q)) {
    return [
      `**Document chase list** — ${documents.length} pending.`,
      ...documents.slice(0, 5).map((d) => `• ${d.client_name} — ${d.document_name} (requested ${prettyDate(d.requested_date)})`),
      ``,
      `Mark them received from the Documents module once the client uploads.`,
    ].join("\n");
  }

  if (/client|how many/.test(q)) {
    return `You have **${clients.length} active clients**. ${clients.slice(0, 4).map((c) => c.name).join(", ")} and ${Math.max(0, clients.length - 4)} more. ${stats.pendingDocuments} documents are pending and ${stats.overdueCompliance} filings are overdue.`;
  }

  return [
    `Here's the current practice snapshot:`,
    `• ${clients.length} active clients`,
    `• ${compliance.length} open compliance tasks (${stats.complianceDueThisWeek} due this week)`,
    `• ${inr(stats.overdueFees)} overdue fees across ${invoices.filter((i) => i.status === "Overdue").length} invoices`,
    `• ${documents.length} documents pending from clients`,
    `• ${leads.length} open leads (${stats.hotLeads} hot)`,
    ``,
    `Ask me about deadlines, fee recovery, documents, or the lead pipeline for a deeper breakdown.`,
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`ai-chat:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return ok({ error: `Slow down — ${limited.retryAfterSec}s before the next prompt` }, 429);
    }

    const body = await readBody(req);
    const message = str(body.message, "Message", { max: 2000 });

    const result = await complete({
      system: `You are the practice copilot for an Indian CA firm. Use the live data below and answer concisely in markdown. Never invent numbers.\n\n${buildContext()}`,
      user: message,
      maxTokens: 500,
      temperature: 0.3,
    });

    const reply = result?.text ?? fallbackReply(message);
    return ok({
      reply,
      source: result ? result.provider : "practice-data",
      disclosure: aiDisclosure(),
    });
  } catch (err) {
    return handle(err);
  }
}