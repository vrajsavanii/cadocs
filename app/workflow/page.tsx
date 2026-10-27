import { listUsers } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildWorkflow } from "@/lib/workflow";
import { WorkflowView } from "@/components/views/workflow";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const { task } = await searchParams;
  const user = await getSessionUser();
  const data = buildWorkflow(user);
  const staff = listUsers().map((person) => ({ name: person.name, role: person.role }));
  return <WorkflowView data={data} staff={staff} role={user?.role ?? "article"} focusTaskId={task} />;
}
