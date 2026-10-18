import fs from "node:fs";
import { dataPath } from "@/lib/data-dir";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Show a local-only hint when the generated first-run credentials file is
  // still on this machine (the app never exposes its contents over HTTP).
  let bootstrapHint = false;
  try {
    bootstrapHint = fs.existsSync(dataPath("bootstrap-credentials.txt"));
  } catch {
    bootstrapHint = false;
  }
  return <LoginForm bootstrapHint={bootstrapHint} />;
}
