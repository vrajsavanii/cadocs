import { getDashboard } from "@/lib/db";
import { AgentView } from "@/components/views/agent";
import { inr, relativeDeadline } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  const data = getDashboard();
  const k = data.kpis;
  const top = data.urgentCompliance[0];
  const brief = top
    ? `• ${k.overdueCompliance} filings overdue, ${k.complianceDueThisWeek} due this week.\n• Highest priority: ${top.client_name} — ${top.compliance_type}, ${relativeDeadline(top.due_date)}.\n• ${inr(k.overdueFees)} overdue across ${data.overdueInvoices.length} invoices; ${k.pendingDocuments} documents still pending.`
    : `• All filings on track. ${k.pendingDocuments} documents pending and ${inr(k.overdueFees)} in overdue fees.`;

  return (
    <AgentView
      brief={brief}
      kpis={{
        clients: k.activeClients,
        dueWeek: k.complianceDueThisWeek,
        overdueFees: inr(k.overdueFees),
        pendingDocs: k.pendingDocuments,
        }}
    />
  );
}
