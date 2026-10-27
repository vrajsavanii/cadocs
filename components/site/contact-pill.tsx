"use client";

import * as React from "react";
import { Mail, Phone, MessageCircle } from "lucide-react";
import { cn } from "@/components/ui";
import { CONTACT } from "@/lib/site-content";
import { mailtoLink, whatsappLink } from "@/lib/format";

export function ContactPill({ className }: { className?: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <div className={cn("inline-flex items-center gap-3 text-[11px]", className)}>
      {CONTACT.email ? (
        <a
          href={mailtoLink(CONTACT.email, undefined, undefined)}
          className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1 text-ink hover:bg-ink/10"
        >
          <Mail className="h-3 w-3" />
          {CONTACT.email}
        </a>
      ) : null}
      {CONTACT.phone ? (
        <a
          href={`tel:${CONTACT.phone}`}
          className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1 text-ink hover:bg-ink/10"
        >
          <Phone className="h-3 w-3" />
          {CONTACT.phone}
        </a>
      ) : null}
      {CONTACT.whatsapp ? (
        <a
          href={whatsappLink(CONTACT.whatsapp, "NexAgent demo request")}
          className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1 text-ink hover:bg-ink/10"
        >
          <MessageCircle className="h-3 w-3" />
          WhatsApp
        </a>
      ) : null}
    </div>
  );
}
