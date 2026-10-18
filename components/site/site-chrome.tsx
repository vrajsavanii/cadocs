"use client";

/**
 * Public-site chrome. Same visual language as the application: canvas ground,
 * translucent blurred bar, green pill CTAs from `buttonClasses`, gold accents
 * for anything AI.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, MessageCircle, Phone, X } from "lucide-react";
import { buttonClasses, cn } from "@/components/ui";

const NAV = [
  { href: "#workflow", label: "Workflow" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#modules", label: "Modules" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Plans" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader({
  productName,
  tagline,
}: {
  productName: string;
  tagline: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [solid, setSolid] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        solid ? "border-black/[0.06] bg-canvas/85 backdrop-blur-xl" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center gap-3 px-4 sm:px-6">
        <Link href="/site" className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green text-[11px] font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(59,82,68,0.8)]">
            CA
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-extrabold tracking-tight text-ink">{productName}</span>
            <span className="block text-[10px] text-muted">{tagline}</span>
          </span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-2 text-[12px] font-bold text-muted transition hover:bg-white/60 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="hidden rounded-full px-3 py-2 text-[12px] font-bold text-muted transition hover:text-ink sm:block">
            Sign in
          </Link>
          <a href="#demo" className={buttonClasses({ className: "h-10 px-4 text-[13px]" })}>
            Book a demo
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/70 text-ink lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="animate-fade border-t border-black/[0.06] bg-canvas/95 px-4 pb-4 pt-2 backdrop-blur-xl lg:hidden">
          <nav className="grid grid-cols-2 gap-1.5">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-2xl bg-white/70 px-3 py-2.5 text-[12px] font-bold text-ink"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <Link href="/login" className="mt-2 block rounded-2xl bg-sage px-3 py-2.5 text-center text-[12px] font-bold text-sage-ink">
            Sign in to the workspace
          </Link>
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter({
  productName,
  companyName,
  tagline,
  phone,
  email,
  modules,
}: {
  productName: string;
  companyName: string;
  tagline: string;
  phone: string;
  email: string;
  modules: string[];
}) {
  return (
    <footer className="mt-20 border-t border-black/[0.06] bg-white/50">
      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-green text-[11px] font-extrabold text-white">CA</span>
            <span className="leading-tight">
              <span className="block text-[13px] font-extrabold tracking-tight text-ink">{productName}</span>
              <span className="block text-[10px] text-muted">
                by {companyName} · {tagline}
              </span>
            </span>
          </div>
          <p className="mt-3 max-w-sm text-[12px] leading-relaxed text-muted">
            Practice management for Indian CA firms — statutory compliance, client work, documents, notices and fee recovery in one
            workspace, with an AI copilot that asks before it changes anything.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {phone ? (
              <a href={`tel:${phone.replace(/\s/g, "")}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-bold text-ink">
                <Phone className="h-3.5 w-3.5" /> {phone}
              </a>
            ) : null}
            {email ? (
              <a href={`mailto:${email}`} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-[11px] font-bold text-ink">
                <MessageCircle className="h-3.5 w-3.5" /> {email}
              </a>
            ) : null}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Modules</p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[12px] text-muted lg:grid-cols-1">
            {modules.slice(0, 8).map((name) => (
              <li key={name}>
                <a href="#modules" className="transition hover:text-ink">
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Get started</p>
          <ul className="mt-3 space-y-1.5 text-[12px]">
            <li>
              <a href="#demo" className="font-bold text-ink transition hover:text-green">
                Book a 15-minute demo
              </a>
            </li>
            <li>
              <Link href="/login" className="text-muted transition hover:text-ink">
                Sign in to the workspace
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="text-muted transition hover:text-ink">
                Privacy &amp; security notice
              </Link>
            </li>
            <li>
              <a href="#faq" className="text-muted transition hover:text-ink">
                Frequently asked questions
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-black/[0.06] px-4 py-5 sm:px-6">
        <p className="mx-auto max-w-[1180px] text-[11px] text-muted">
          © {new Date().getFullYear()} {companyName} ({productName}). Every firm that signs in gets its own private workspace — client
          records stay with the firm, never with us.
        </p>
      </div>
    </footer>
  );
}

/** Phone-only CTA bar — the site's most common entry point is a shared link. */
export function MobileCta({ whatsapp, phone }: { whatsapp: string; phone: string }) {
  const wa = whatsapp || phone;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.06] bg-canvas/90 px-3 py-2.5 backdrop-blur-xl lg:hidden">
      <div className="flex items-center gap-2">
        <a href="#demo" className={buttonClasses({ className: "h-11 flex-1 text-[13px]" })}>
          Book a demo
        </a>
        {wa ? (
          <a
            href={`https://wa.me/${wa.replace(/\D/g, "")}`}
            className="inline-flex h-11 items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 text-[13px] font-bold text-ink"
          >
            <MessageCircle className="h-4 w-4 text-green" /> WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
