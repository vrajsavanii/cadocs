"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Button, Card, Field } from "./ui";

export function LoginForm({ bootstrapHint }: { bootstrapHint: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Sign-in failed");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green text-sm font-extrabold text-white shadow-[0_10px_30px_-12px_rgba(59,82,68,0.7)]">
            CA
          </span>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">CADocs</h1>
          <p className="mt-1 text-xs text-muted">Sign in to your firm&rsquo;s workspace</p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Username">
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
              />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error ? (
              <p role="alert" className="rounded-xl bg-[#FBEAE7] px-3 py-2 text-xs font-semibold text-[#B4433A]">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy} className="w-full">
              <Lock className="h-4 w-4" /> Sign in
            </Button>
          </form>

          <p className="mt-4 flex items-start gap-2 rounded-xl bg-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
            Sessions last 12 hours. Passwords are hashed with scrypt and every action is recorded in the audit trail.
          </p>

          {bootstrapHint ? (
            <p className="mt-2 rounded-xl bg-gold-soft/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
              <KeyRound className="mr-1 inline h-3 w-3 text-gold" />
              First run? Your generated sign-in credentials are in <code className="font-mono">.data/bootstrap-credentials.txt</code> — change them in Settings → Security.
            </p>
          ) : null}
        </Card>

        <p className="mt-4 text-center text-[11px] text-muted">
          <a className="underline hover:text-ink" href="/privacy">
            Privacy &amp; security notice
          </a>
        </p>

        <p className="mt-3 text-center text-[11px] text-muted">
          New to the software?{" "}
          <a className="font-bold text-green underline decoration-green/30 underline-offset-2 hover:text-green-dark" href="/site">
            See what it does
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-ink" href="/site#demo">
            Book a demo
          </a>
        </p>
      </div>
    </div>
  );
}