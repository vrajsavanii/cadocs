import { getSettings, listClients, listInvoices } from "@/lib/db";
import { InvoicesView } from "@/components/views/invoices";
import { SectionTabs } from "@/components/section-tabs";

export const dynamic = "force-dynamic";

export default function InvoicesPage() {
  return (
    <>
      <SectionTabs />
      <InvoicesView invoices={listInvoices()} clients={listClients()} settings={getSettings()} />
    </>
  );
}
