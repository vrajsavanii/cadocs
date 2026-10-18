import { getSettings, listClients, listCompliance } from "@/lib/db";
import { ComplianceView } from "@/components/views/compliance";

export const dynamic = "force-dynamic";

export default function CompliancePage() {
  return (
    <ComplianceView
      compliance={listCompliance()}
      clients={listClients()}
      firmName={getSettings().firm_name ?? "your CA firm"}
    />
  );
}
