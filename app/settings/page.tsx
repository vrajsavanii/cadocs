import { getSettings, listUsers } from "@/lib/db";
import { aiDisclosure } from "@/lib/ai";
import { getSessionUser } from "@/lib/auth";
import { SettingsView } from "@/components/views/settings";
import nextPkg from "next/package.json";
import reactPkg from "react/package.json";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  const disclosure = aiDisclosure();
  const settings = {
    ...getSettings(),
    groq_configured: disclosure.provider ? "true" : "",
    ai_provider: disclosure.provider ?? "",
    ai_model: disclosure.model ?? "",
    ai_required_scope: disclosure.scope,
    auth_mode: user ? `${user.name} · ${user.role}` : "",
  };

  return (
    <SettingsView
      settings={settings}
      system={{
        node: process.version,
        next: nextPkg.version,
        react: reactPkg.version,
        database: "SQLite (node:sqlite, encrypted PAN/GSTIN)",
      }}
      users={user?.role === "partner" ? listUsers() : null}
      currentRole={user?.role ?? null}
    />
  );
}
