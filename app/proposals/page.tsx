import { listLeads, listProposals } from "@/lib/db";
import { ProposalsView } from "@/components/views/proposals";

export const dynamic = "force-dynamic";

export default function ProposalsPage() {
  return <ProposalsView proposals={listProposals()} leads={listLeads()} />;
}
