import { listClients, listUdin } from "@/lib/db";
import { UdinView } from "@/components/views/udin";

export const dynamic = "force-dynamic";

export default function UdinPage() {
  return <UdinView records={listUdin()} clients={listClients().map((c) => c.name)} />;
}
