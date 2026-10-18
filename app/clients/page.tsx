import { getSettings, listClients } from "@/lib/db";
import { ClientsView } from "@/components/views/clients";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const settings = getSettings();
  return <ClientsView clients={listClients()} firmName={settings.firm_name ?? "our firm"} focusClientId={client} />;
}
