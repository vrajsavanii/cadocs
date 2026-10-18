"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Search, X, AlertCircle, Sparkles } from "lucide-react";
import { cn } from "./ui";

// ── Toasts ────────────────────────────────────────────────────────────────────
type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type ToastContextValue = { toast: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = React.createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const toast = React.useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="animate-rise pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-black/5 bg-white/95 px-4 py-3 text-sm shadow-[0_16px_40px_-12px_rgba(0,0,0,0.25)] backdrop-blur"
          >
            {t.tone === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#B4433A]" />
            ) : t.tone === "info" ? (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3E8A52]" />
            )}
            <span className="text-ink">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="animate-fade absolute inset-0 bg-[#19201C]/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-rise relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-ink">{title}</h2>
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted transition hover:bg-black/5 hover:text-ink"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ── Global search ─────────────────────────────────────────────────────────────
type SearchResult = { id: string; label: string; sublabel: string; href: string };
type SearchPayload = { groups: Array<{ title: string; items: SearchResult[] }> };

export function SearchDialog() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<SearchPayload>({ groups: [] });
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setData({ groups: [] });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (res.ok) setData(await res.json());
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const results = data.groups.flatMap((g) => g.items);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-9 w-56 items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 text-xs text-muted transition hover:border-black/20 hover:bg-white md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        Search practice…
        <kbd className="ml-auto rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold">⌘K</kbd>
      </button>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/70 text-muted md:hidden"
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[10vh]">
              <div className="animate-fade absolute inset-0 bg-[#19201C]/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
              <div className="animate-rise relative w-full max-w-xl overflow-hidden rounded-[24px] bg-white shadow-2xl">
                <div className="flex items-center gap-2 border-b border-black/5 px-4">
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search clients, leads, invoices, notices…"
                    className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
                  />
                  <button onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-black/5">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-[55vh] overflow-y-auto p-2">
                  {loading ? <p className="px-3 py-6 text-center text-xs text-muted">Searching…</p> : null}
                  {!loading && query.trim().length >= 2 && results.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted">No matches for “{query}”.</p>
                  ) : null}
                  {data.groups.map((group) =>
                    group.items.length ? (
                      <div key={group.title} className="mb-1">
                        <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{group.title}</p>
                        {group.items.map((item) => (
                          <button
                            key={`${group.title}-${item.id}`}
                            onClick={() => {
                              setOpen(false);
                              setQuery("");
                              router.push(item.href);
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-subtle"
                          >
                            <span>
                              <span className="block text-sm font-semibold text-ink">{item.label}</span>
                              <span className="block text-[11px] text-muted">{item.sublabel}</span>
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Open</span>
                          </button>
                        ))}
                      </div>
                    ) : null,
                  )}
                  {query.trim().length < 2 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted">Type at least 2 characters to search across the practice.</p>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-bold text-green underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
