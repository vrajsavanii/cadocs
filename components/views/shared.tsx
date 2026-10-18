"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle, Search, Send, Sparkles } from "lucide-react";
import { Modal, useToast } from "../interactive";
import { Button, cn } from "../ui";
import { whatsappLink, mailtoLink } from "@/lib/format";

export function useMutation() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function mutate<T = unknown>(
    url: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body?: unknown,
    successMessage?: string,
  ): Promise<T | null> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(data?.error || "Request failed. Please try again.");
      if (successMessage) toast(successMessage);
      router.refresh();
      return data;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Request failed", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, mutate };
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-[11px] font-bold transition",
            value === option.value ? "bg-green text-white" : "bg-white/70 text-muted ring-1 ring-black/5 hover:text-ink",
          )}
        >
          {option.label}
          {option.count !== undefined ? (
            <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[9px]", value === option.value ? "bg-white/20" : "bg-black/[0.06]")}>
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input h-9 pl-8 text-xs"
      />
    </div>
  );
}

type ReminderButtonProps = {
  recipient: string;
  phone?: string | null;
  email?: string | null;
  message: string;
  subject?: string;
  relatedType?: string;
  relatedId?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "soft" | "danger";
  size?: "sm" | "md";
};

/**
 * Records a client reminder in the communication log and opens the selected
 * channel pre-filled. Nothing is claimed as "sent" unless the channel opens.
 */
export function ReminderButton({
  recipient,
  phone,
  email,
  message,
  subject = "",
  relatedType = "",
  relatedId = "",
  label = "Remind",
  variant = "ghost",
  size = "sm",
}: ReminderButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [channel, setChannel] = React.useState<"WhatsApp" | "Email">(phone ? "WhatsApp" : "Email");
  const [body, setBody] = React.useState(message);
  const [subjectText, setSubjectText] = React.useState(subject);
  const [logging, setLogging] = React.useState(false);
  const [rewriting, setRewriting] = React.useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const canWhatsApp = Boolean(phone);
  const canEmail = Boolean(email);
  if (!canWhatsApp && !canEmail) return null;

  async function rewriteWithAi() {
    setRewriting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          channel,
          subject: subjectText,
          message: body || message,
          firm_note: relatedType ? `Context: ${relatedType}` : "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { draft?: string; error?: string; source?: string };
      if (!res.ok || !data.draft) {
        toast(data.error || "Could not draft the message", "error");
        return;
      }
      setBody(data.draft);
      toast(data.source && data.source !== "template" ? `Rewritten by ${data.source}` : "Draft tidied with the local template");
    } catch {
      toast("The AI draft service is unreachable", "error");
    } finally {
      setRewriting(false);
    }
  }

  async function openAndLog() {
    const href = channel === "WhatsApp" ? whatsappLink(phone ?? "", body) : mailtoLink(email ?? "", subjectText, body);
    const win = window.open(href, "_blank", "noopener,noreferrer");
    if (!win) {
      toast("Allow pop-ups to open WhatsApp or your email app", "error");
      return;
    }
    setLogging(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          recipient_name: recipient,
          to_address: channel === "WhatsApp" ? phone : email,
          subject: channel === "Email" ? subjectText : "",
          body,
          related_type: relatedType,
          related_id: relatedId,
        }),
      });
      if (!res.ok) throw new Error("Could not log the reminder");
      toast(`Reminder logged for ${recipient}`);
      router.refresh();
      setOpen(false);
    } catch {
      toast("The reminder opened but could not be logged", "error");
    } finally {
      setLogging(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {variant === "ghost" ? <Send className="h-3.5 w-3.5" /> : null}
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Remind ${recipient}`}
        description="Opens WhatsApp or your email app pre-filled, then records the reminder against this client."
      >
        <div className="space-y-3">
          <div className="flex gap-1.5 rounded-full bg-subtle p-1">
            {canWhatsApp ? (
              <button
                onClick={() => setChannel("WhatsApp")}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold transition", channel === "WhatsApp" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </button>
            ) : null}
            {canEmail ? (
              <button
                onClick={() => setChannel("Email")}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-bold transition", channel === "Email" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}
              >
                <Mail className="h-3.5 w-3.5" /> Email
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted">
            To <span className="font-semibold text-ink">{channel === "WhatsApp" ? phone : email}</span>
          </p>
          {channel === "Email" ? (
            <input className="input" value={subjectText} onChange={(e) => setSubjectText(e.target.value)} placeholder="Subject" />
          ) : null}
          <textarea
            className="input min-h-[150px] resize-y py-2.5"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Reminder message"
          />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => void rewriteWithAi()} loading={rewriting}>
              <Sparkles className="h-3.5 w-3.5" /> Rewrite with AI
            </Button>
            <span className="text-[10px] text-muted">Review before sending</span>
          </div>
          <p className="rounded-xl bg-gold-soft/60 px-3 py-2 text-[10px] leading-relaxed text-muted">
            Nothing is sent automatically. The message opens in {channel === "WhatsApp" ? "WhatsApp" : "your mail app"}, and this log records that you followed up.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={openAndLog} loading={logging}>
              {channel === "WhatsApp" ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              Open {channel === "WhatsApp" ? "WhatsApp" : "email"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight text-ink">{title}</h2>
          {subtitle ? <p className="text-[11px] text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
