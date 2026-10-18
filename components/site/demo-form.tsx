"use client";

/**
 * Demo request form. Submitting creates a real lead in the practice's Leads
 * module (source: "Website demo request"), so the enquiry lands in the same
 * pipeline the firm already works — no inbox to forget.
 */
import * as React from "react";
import { ArrowRight, CheckCircle2, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { DEMO_PAINS, DEMO_SIZES } from "@/lib/site-content";

type State = "idle" | "sending" | "done" | "error";

const field =
  "w-full rounded-[14px] border border-black/10 bg-white px-3.5 py-2.5 text-[13px] text-ink outline-none transition focus:border-green focus:ring-4 focus:ring-green/10";
const label = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-muted";

export function DemoForm({ whatsapp, productName, companyName }: { whatsapp: string; productName: string; companyName: string }) {
  const [state, setState] = React.useState<State>("idle");
  const [error, setError] = React.useState("");
  const [values, setValues] = React.useState({
    name: "",
    firm: "",
    phone: "",
    email: "",
    city: "",
    size: DEMO_SIZES[1] as string,
    pain: DEMO_PAINS[0] as string,
    note: "",
  });
  const [trap, setTrap] = React.useState("");

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = values.phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setState("error");
      setError("Enter a 10-digit mobile number so we can call you back.");
      return;
    }
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/public/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website: trap }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState("error");
        setError(data.error || "We could not save that. Please try WhatsApp instead.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setError("Network problem — please try WhatsApp or call us.");
    }
  }

  if (state === "done") {
    const wa = whatsapp.replace(/\D/g, "");
    return (
      <div className="animate-rise rounded-[24px] border border-black/[0.06] bg-white p-6 shadow-[0_30px_60px_-30px_rgba(25,32,28,0.3)] sm:p-7">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage text-sage-ink">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-[22px] font-extrabold tracking-tight text-ink">Request logged — you are in the pipeline</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Your enquiry is now a scored lead inside {productName}&rsquo;s own lead desk at {companyName}, so it will not sit in an inbox. We
          call back within one working day, usually sooner.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {wa ? (
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent("Hi, I just requested a demo of the CA practice software.")}`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-green px-5 text-[13px] font-semibold text-white"
            >
              <MessageCircle className="h-4 w-4" /> Continue on WhatsApp
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setState("idle");
              setValues((v) => ({ ...v, name: "", phone: "", email: "", note: "" }));
            }}
            className="inline-flex h-11 items-center rounded-full border border-black/10 bg-white px-5 text-[13px] font-semibold text-ink"
          >
            Send another
          </button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-green" /> We never share your details, and we do not add you to any campaign list.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[24px] border border-black/[0.06] bg-white p-6 shadow-[0_30px_60px_-30px_rgba(25,32,28,0.3)] sm:p-7"
    >        <h3 className="text-[22px] font-extrabold tracking-tight text-ink">See {productName} working on your own practice</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        15 minutes, screen shared, no slides. We open the workspace and walk through your busiest week.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="demo-name">
            Your name
          </label>
          <input id="demo-name" className={field} value={values.name} onChange={set("name")} required placeholder="Rohan Mehta" autoComplete="name" />
        </div>
        <div>
          <label className={label} htmlFor="demo-firm">
            Firm name
          </label>
          <input id="demo-firm" className={field} value={values.firm} onChange={set("firm")} placeholder="Mehta & Co." autoComplete="organization" />
        </div>
        <div>
          <label className={label} htmlFor="demo-phone">
            Mobile / WhatsApp
          </label>
          <input id="demo-phone" className={field} value={values.phone} onChange={set("phone")} required inputMode="tel" placeholder="98765 43210" autoComplete="tel" />
        </div>
        <div>
          <label className={label} htmlFor="demo-email">
            Email
          </label>
          <input id="demo-email" type="email" className={field} value={values.email} onChange={set("email")} placeholder="you@firm.in" autoComplete="email" />
        </div>
        <div>
          <label className={label} htmlFor="demo-city">
            City
          </label>
          <input id="demo-city" className={field} value={values.city} onChange={set("city")} placeholder="Mumbai" autoComplete="address-level2" />
        </div>
        <div>
          <label className={label} htmlFor="demo-size">
            Team size
          </label>
          <select id="demo-size" className={field} value={values.size} onChange={set("size")}>
            {DEMO_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="demo-pain">
            What hurts most right now?
          </label>
          <select id="demo-pain" className={field} value={values.pain} onChange={set("pain")}>
            {DEMO_PAINS.map((pain) => (
              <option key={pain} value={pain}>
                {pain}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="demo-note">
            Anything specific you want to see?
          </label>
          <textarea
            id="demo-note"
            className={cn(field, "min-h-[76px] resize-none")}
            value={values.note}
            onChange={set("note")}
            placeholder="We file GST for about 90 clients and chase documents on WhatsApp…"
          />
        </div>
      </div>

      {/* Honeypot: real people never fill this in. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="demo-website">Website</label>
        <input id="demo-website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>

      {state === "error" ? (
        <p role="alert" className="mt-3 rounded-2xl bg-[#FBEAE7] px-3.5 py-2.5 text-[12px] font-semibold text-[#A33B2E]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={state === "sending"} className="min-w-[190px]">
          {state === "sending" ? "Sending…" : "Request my demo"}
          {state === "sending" ? null : <ArrowRight className="h-4 w-4" />}
        </Button>
        {whatsapp ? (
          <a
            href={`https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent("Hi, I would like a demo of your CA practice software.")}`}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-black/10 bg-white px-5 text-[14px] font-semibold text-ink"
          >
            <MessageCircle className="h-4 w-4 text-green" /> Prefer WhatsApp
          </a>
        ) : null}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0 text-green" />
        Your details are used only to arrange the demo. We never sell them, never add you to a campaign list, and delete them on
        request.
      </p>
      {state === "sending" ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating your lead…
        </p>
      ) : null}
    </form>
  );
}
