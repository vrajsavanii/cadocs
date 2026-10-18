import { listClients, listNotices } from "@/lib/db";
import { NoticesView } from "@/components/views/notices";

export const dynamic = "force-dynamic";

export default function NoticesPage() {
  return <NoticesView notices={listNotices()} clients={listClients().map((c) => c.name)} />;
}
