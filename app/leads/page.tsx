import { listLeads } from "@/lib/db";
import { LeadsView } from "@/components/views/leads";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return <LeadsView leads={listLeads()} />;
}
