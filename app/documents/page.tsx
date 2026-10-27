import { getSessionUser } from "@/lib/auth";
import { getSettings, listClients, listDocuments } from "@/lib/db";
import { listDocumentRequests } from "@/lib/engagements-db";
import { DocumentsView } from "@/components/views/documents";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await getSessionUser();
  return (
    <DocumentsView
      documents={listDocuments()}
      clients={listClients()}
      firmName={getSettings().firm_name ?? "your CA firm"}
      requests={listDocumentRequests()}
      role={user?.role ?? "article"}
    />
  );
}
