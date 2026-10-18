import { listClients, listDsc } from "@/lib/db";
import { DscView } from "@/components/views/dsc";

export const dynamic = "force-dynamic";

export default function DscPage() {
  return <DscView records={listDsc()} clients={listClients().map((c) => c.name)} />;
}
