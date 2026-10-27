/**
 * Deterministic practice insights — the "AI analyst" that runs on live data
 * with zero network dependency. Every insight is computed from real rows
 * (no generation = no hallucinated numbers), and each carries a next action.
 *
 * The copilot can dress these up in prose when a provider is configured, but
 * the underlying rules below are the source of truth and are also rendered
 * directly on the dashboard.
 */
import {
  countQueuedMessages,
  getDashboard,
  listCompliance,
  listDocuments,
  listDsc,
  listInvoices,
  listNotices,
  listProposals,
  listTimesheets,
} from "./db";
import { compactInr, dayDiff, inr, prettyDate } from "./format";

export type Insight = {
  id: string;
  tone: "risk" | "warn" | "good" | "info";
  title: string;
  body: string;
  action_label?: string;
  action_href?: string;
};

export function buildInsights(): Insight[] {
  const insights: Insight[] = [];
  const kpis = getDashboard().kpis;
  const invoices = listInvoices().filter((i) => i.status !== "Cancelled" && i.status !== "Paid");
  const compliance = listCompliance();
  const overdueTasks = compliance.filter((c) => c.status === "Overdue");

  // 1. Concentration risk — one client dominating receivables.
  const outstandingByClient = new Map<string, number>();
  for (const inv of invoices) {
    const open = inv.total_amount - (inv.paid_amount ?? 0);
    if (open <= 0) continue;
    outstandingByClient.set(inv.client_name, (outstandingByClient.get(inv.client_name) ?? 0) + open);
  }
  const totalOpen = [...outstandingByClient.values()].reduce((s, v) => s + v, 0);
  const top = [...outstandingByClient.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && totalOpen > 0 && top[1] / totalOpen > 0.3) {
    insights.push({
      id: "concentration",
      tone: "warn",
      title: "Receivables concentration",
      body: `${top[0]} alone holds ${Math.round((top[1] / totalOpen) * 100)}% of open receivables (${inr(top[1])} of ${inr(totalOpen)}). One delayed payment moves your cash flow.`,
      action_label: "Open invoices",
      action_href: "/invoices",
    });
  }

  // 2. Overdue compliance clustered by filing type.
  if (overdueTasks.length > 0) {
    const byType = new Map<string, number>();
    for (const t of overdueTasks) byType.set(t.compliance_type, (byType.get(t.compliance_type) ?? 0) + 1);
    const [worstType, worstCount] = [...byType.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const oldest = [...overdueTasks].sort((a, b) => dayDiff(a.due_date) - dayDiff(b.due_date))[0]!;
    insights.push({
      id: "overdue-cluster",
      tone: "risk",
      title: `${overdueTasks.length} filings overdue`,
      body: `${worstCount} of them are ${worstType}. Oldest: ${oldest.client_name}, ${prettyDate(oldest.due_date)} (${Math.abs(dayDiff(oldest.due_date))} days late) — penalties grow daily.`,
      action_label: "Work the calendar",
      action_href: "/compliance",
    });
  }

  // 3. Document requests stalling (pending > 7 days).
  const now = Date.now();
  const stalled = listDocuments().filter(
    (d) => d.status === "Pending" && now - new Date(d.requested_date).getTime() > 7 * 86_400_000,
  );
  if (stalled.length > 0) {
    const worst = stalled[0]!;
    insights.push({
      id: "stalled-docs",
      tone: "warn",
      title: `${stalled.length} document requests stalled`,
      body: `${worst.client_name} has been sitting on "${worst.document_name}" for ${Math.floor((now - new Date(worst.requested_date).getTime()) / 86_400_000)} days. Chasing beats waiting.`,
      action_label: "Chase documents",
      action_href: "/documents",
    });
  }

  // 4. Collection speed — overdue fees ageing.
  const overdueFees = invoices
    .filter((i) => i.status === "Overdue")
    .reduce((s, i) => s + (i.total_amount - (i.paid_amount ?? 0)), 0);
  if (overdueFees > 0 && kpis.collectionRate < 70) {
    insights.push({
      id: "collection",
      tone: "risk",
      title: `Collection rate at ${kpis.collectionRate}%`,
      body: `${inr(overdueFees)} is past due while ${inr(kpis.totalBilled - kpis.totalCollected)} is open overall. A single reminder round this week typically recovers the oldest bucket first.`,
      action_label: "See ageing",
      action_href: "/reports",
    });
  }

  // 5. Utilization — approved billable share this period.
  const hours = listTimesheets();
  const totalHours = hours.reduce((s, t) => s + t.hours, 0);
  const billableHours = hours.filter((t) => t.billable).reduce((s, t) => s + t.hours, 0);
  if (totalHours >= 8 && billableHours / totalHours < 0.6) {
    insights.push({
      id: "utilization",
      tone: "info",
      title: "Billable share below 60%",
      body: `Only ${Math.round((billableHours / totalHours) * 100)}% of ${totalHours.toFixed(1)} logged hours are billable. Non-billable drift is silent margin loss.`,
      action_label: "Review timesheets",
      action_href: "/timesheets",
    });
  }

  // 6. Certificates and notices approaching deadlines.
  const expiringDsc = listDsc().filter((d) => {
    const diff = dayDiff(d.valid_until);
    return diff >= 0 && diff <= 30;
  });
  const urgentNotices = listNotices().filter(
    (n) => n.status !== "Closed" && dayDiff(n.response_deadline) <= 7,
  );
  if (expiringDsc.length > 0) {
    insights.push({
      id: "dsc-expiry",
      tone: "warn",
      title: `${expiringDsc.length} DSC token(s) expiring within 30 days`,
      body: `${expiringDsc
        .slice(0, 3)
        .map((d) => `${d.client_name} (${prettyDate(d.valid_until)})`)
        .join(", ")}. An expired token stops filings mid-flow.`,
      action_label: "DSC tracker",
      action_href: "/dsc",
    });
  }
  if (urgentNotices.length > 0) {
    insights.push({
      id: "notice-deadlines",
      tone: "risk",
      title: `${urgentNotices.length} notice reply deadline(s) within 7 days`,
      body: urgentNotices
        .slice(0, 3)
        .map((n) => `${n.client_name}: ${n.notice_type} due ${prettyDate(n.response_deadline)}`)
        .join("; "),
      action_label: "Open notices",
      action_href: "/notices",
    });
  }

  // 7. Pipeline — proposals without a client conversion.
  const proposals = listProposals();
  const accepted = proposals.filter((p) => p.status === "Accepted").length;
  if (proposals.length > 0 && accepted === 0) {
    insights.push({
      id: "pipeline",
      tone: "info",
      title: "No proposals accepted yet",
      body: "Send an engagement proposal to convert interest into a client engagement.",
      action_label: "Work pipeline",
      action_href: "/proposals",
    });
  }

  // 8. Automation outbox waiting for a human send.
  const queued = countQueuedMessages();
  if (queued > 0) {
    insights.push({
      id: "outbox",
      tone: queued >= 10 ? "warn" : "info",
      title: `${queued} prepared message(s) waiting in the outbox`,
      body:
        queued >= 10
          ? "Automation has drafted a batch of chasers and reminders. Open them, send on WhatsApp/email and mark them sent — otherwise the next sweep adds to the pile."
          : "Automation prepared client chasers and fee reminders overnight. Send or dismiss them so the record stays true.",
      action_label: "Open automation",
      action_href: "/automation",
    });
  }

  const rank = { risk: 0, warn: 1, info: 2, good: 3 } as const;
  return insights.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 6);
}

/**
 * Morning-brief fallback (keyless mode): one tight paragraph from the same
 * live rows. The AI route upgrades this prose when a provider is configured.
 */
export function deterministicBrief(): string {
  const k = getDashboard().kpis;
  const overdue = listCompliance().filter((c) => c.status === "Overdue");
  const overdueInvoices = listInvoices().filter((i) => i.status === "Overdue");
  const next = [...overdue]
    .sort((a, b) => dayDiff(a.due_date) - dayDiff(b.due_date))
    .slice(0, 2)
    .map((c) => `${c.client_name} — ${c.compliance_type} (${prettyDate(c.due_date)})`)
    .join("; ");

  const queued = countQueuedMessages();
  const parts = [
    `${k.complianceDueThisWeek} filings are due this week and ${overdue.length} are already past due${next ? ` — oldest are ${next}` : ""}.`,
    `${inr(k.overdueFees)} sits overdue across ${overdueInvoices.length} invoices; collection rate is ${k.collectionRate}%.`,
    `${k.pendingDocuments} client documents are still pending.
`,
    queued > 0 ? `Automation has prepared ${queued} chaser/reminder message(s) — send them from the outbox.` : "",
  ].filter(Boolean);
  const insight = buildInsights()[0];
  if (insight) parts.push(`Top risk right now: ${insight.title} — ${insight.body}`);
  return parts.join(" ");
}

export function compactAmount(value: number): string {
  return compactInr(value);
}