import { getSettings, listCampaigns, listClients, listCompliance, listDocuments, listInvoices } from "@/lib/db";
import { CampaignsView } from "@/components/views/campaigns";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function CampaignsPage() {
  return (
    <>
      <SectionTabs />
      <CampaignsView
        clients={listClients()}
        compliance={listCompliance()}
        documents={listDocuments()}
        invoices={listInvoices()}
        campaigns={listCampaigns()}
        firmName={getSettings().firm_name ?? "Sharma & Associates"}
      />
    </>
  );
}
