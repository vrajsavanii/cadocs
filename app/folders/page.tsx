import { listClients, listDocuments } from "@/lib/db";
import { listClientServices, listDocumentRequests } from "@/lib/engagements-db";
import { FoldersView } from "@/components/views/folders";

export const dynamic = "force-dynamic";

export default function FoldersPage() {
  return (
    <FoldersView
      clients={listClients()}
      documents={listDocuments()}
      requests={listDocumentRequests()}
      services={listClientServices()}
    />
  );
}
