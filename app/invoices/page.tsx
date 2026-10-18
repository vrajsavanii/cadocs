import { getSettings, listClients, listInvoices } from "@/lib/db";
import { InvoicesView } from "@/components/views/invoices";

export const dynamic = "force-dynamic";

export default function InvoicesPage() {
  return <InvoicesView invoices={listInvoices()} clients={listClients()} settings={getSettings()} />;
}
