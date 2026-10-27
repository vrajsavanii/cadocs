import { getSettings, listClients, listCompliance } from "@/lib/db";
import { toWorkflowTask } from "@/lib/workflow";
import { ComplianceView } from "@/components/views/compliance";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function CompliancePage() {
  return (
    <>
      <SectionTabs />
      <ComplianceView
        tasks={listCompliance().map(toWorkflowTask)}
        clients={listClients()}
        firmName={getSettings().firm_name ?? "your CA firm"}
      />
    </>
  );
}
