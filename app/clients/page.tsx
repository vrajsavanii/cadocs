import { getSettings, listClients, listUsers } from "@/lib/db";
import { ClientsView } from "@/components/views/clients";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const settings = getSettings();
  const staff = listUsers().map((user) => ({ name: user.name, role: user.role }));
  return <ClientsView clients={listClients()} firmName={settings.firm_name ?? "our firm"} focusClientId={client} staff={staff} />;
}
