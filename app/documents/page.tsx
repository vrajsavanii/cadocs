import { getSettings, listClients, listDocuments } from "@/lib/db";
import { DocumentsView } from "@/components/views/documents";

export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  return (
    <DocumentsView
      documents={listDocuments()}
      clients={listClients()}
      firmName={getSettings().firm_name ?? "your CA firm"}
    />
  );
}
