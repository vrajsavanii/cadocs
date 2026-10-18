"use client";

/**
 * The workflow story: seven stages of how work moves through the practice,
 * animated as you scroll.
 *
 * Desktop gets a sticky stage that advances with scroll — each incoming screen
 * grows into place (zoom in) while the outgoing one drifts back and fades (zoom
 * out), and the reveal *inside* a screen is driven by how far the reader is
 * through that stage's slot, so the product appears to work itself.
 *
 * Phones get the same screens stacked as cards with looping playback instead —
 * scroll-hijacking on a phone reads as a broken page.
 */
import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/components/ui";
import { WORKFLOW } from "@/lib/site-content";
import { FitBox, Reveal, scheduleTick, useReducedMotion } from "./anim";
import {
  AppFrame,
  CollectionsScreen,
  ComplianceScreen,
  DocumentsScreen,
  LeadsScreen,
  LoopPlayer,
  NoticeScreen,
  OnboardingScreen,
  ProposalScreen,
} from "./mockups";

type ScreenProps = { step: number };

const SCREENS: Record<string, { Screen: React.ComponentType<ScreenProps>; active: string; script: number }> = {
  leads: { Screen: LeadsScreen, active: "/leads", script: 3 },
  proposal: { Screen: ProposalScreen, active: "/proposals", script: 3 },
  onboarding: { Screen: OnboardingScreen, active: "/clients", script: 3 },
  documents: { Screen: DocumentsScreen, active: "/documents", script: 3 },
  compliance: { Screen: ComplianceScreen, active: "/compliance", script: 2 },
  notices: { Screen: NoticeScreen, active: "/notices", script: 4 },
  collections: { Screen: CollectionsScreen, active: "/invoices", script: 3 },
};

export function WorkflowStory() {
  const sectionRef = React.useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const [state, setState] = React.useState({ progress: 0, index: 0, step: 0 });

  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let raf = 0;
    let pending: (() => void) | null = null;

    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const distance = rect.height - window.innerHeight;
      const p = distance <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / distance));
      const position = p * WORKFLOW.length;
      const index = Math.min(WORKFLOW.length - 1, Math.floor(position));
      const fraction = Math.min(1, position - index);
      const script = SCREENS[WORKFLOW[index]!.id]?.script ?? 3;
      const step = Math.min(script, Math.floor(fraction * (script + 1)));
      setState((prev) =>
        prev.index === index && prev.step === step && Math.abs(prev.progress - p) < 0.002 ? prev : { progress: p, index, step },
      );
    };

    const onScroll = () => {
      // Coalesce bursts of scroll events onto the next frame, with a timer
      // fallback so a paused compositor cannot strand the stage.
      if (!raf) {
        raf = 1;
        pending = scheduleTick(() => {
          raf = 0;
          update();
        });
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      pending?.();
    };
  }, []);

  const goTo = (index: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const distance = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (index / WORKFLOW.length) * distance + 8, behavior: reduced ? "auto" : "smooth" });
  };

  const stage = WORKFLOW[state.index]!;

  return (
    <>
      {/* ── Desktop: sticky, scroll-driven ────────────────────────────────── */}
      <div
        ref={sectionRef}
        className="relative hidden lg:block"
        style={{ height: `${WORKFLOW.length * 74 + 100}vh` }}
      >
        <div className="sticky top-0 flex h-screen items-center">
          <div className="w-full">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">The workflow</p>
                <h2 className="mt-1 text-[34px] font-extrabold leading-[1.1] tracking-tight text-ink">
                  Seven steps, one desk — scroll to follow the work
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] font-bold text-muted">
                  <span className="text-ink">{String(state.index + 1).padStart(2, "0")}</span> / {String(WORKFLOW.length).padStart(2, "0")}
                </span>
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-black/[0.08]">
                  <div className="h-full rounded-full bg-green transition-[width] duration-500" style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[290px_minmax(0,1fr)] gap-9">
              <div className="flex flex-col gap-4">
                <ol className="space-y-1">
                  {WORKFLOW.map((item, i) => {
                    const done = i < state.index;
                    const current = i === state.index;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => goTo(i)}
                          aria-current={current ? "step" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-all duration-300",
                            current ? "bg-green text-white shadow-[0_12px_30px_-16px_rgba(59,82,68,0.9)]" : done ? "bg-sage/70 text-sage-ink" : "text-muted hover:bg-white/60",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold transition-transform duration-300",
                              current ? "scale-110 bg-white/20 text-white" : done ? "bg-green text-white" : "bg-black/[0.06] text-muted",
                            )}
                          >
                            {done ? <Check className="h-3 w-3" /> : i + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-bold">{item.title.split(",")[0]}</span>
                            <span className={cn("block truncate text-[10px]", current ? "text-white/70" : "text-muted")}>{item.eyebrow.split("·")[1]?.trim()}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                <div className="rounded-[22px] border border-black/[0.06] bg-white/70 p-3.5">
                  <div key={stage.id} className="animate-rise">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{stage.eyebrow}</p>
                    <p className="mt-1 text-[24px] font-extrabold leading-none tracking-tight text-green">{stage.metric}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">{stage.metricLabel}</p>
                    <p className="mt-2.5 flex items-start gap-1.5 text-[11px] font-semibold text-ink">
                      <Sparkles className="mt-[2px] h-3.5 w-3.5 shrink-0 text-gold" />
                      {stage.outcome}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <FitBox width={1180}>
                  <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
                    {WORKFLOW.map((item, i) => {
                      if (Math.abs(i - state.index) > 1) return null;
                      const config = SCREENS[item.id]!;
                      const Screen = config.Screen;
                      const current = i === state.index;
                      return (
                        <div
                          key={item.id}
                          aria-hidden={!current}
                          style={{
                            gridArea: "1 / 1",
                            opacity: current ? 1 : 0,
                            transform: current ? "none" : i < state.index ? "scale(1.07)" : "scale(0.9)",
                            filter: current ? "none" : "blur(4px)",
                            transition: "opacity .55s ease, transform .75s cubic-bezier(.22,1,.36,1), filter .55s ease",
                            pointerEvents: current ? "auto" : "none",
                            willChange: current ? "auto" : "transform, opacity",
                          }}
                        >
                          <AppFrame active={config.active} badges={{ documents: 9, compliance: 7, invoices: 4 }}>
                            <Screen step={current ? state.step : config.script} />
                          </AppFrame>
                        </div>
                      );
                    })}
                  </div>
                </FitBox>

                <div key={`caption-${stage.id}`} className="animate-rise mt-4 max-w-[640px]">
                  <h3 className="text-[19px] font-extrabold tracking-tight text-ink">{stage.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{stage.body}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile: stacked cards with looping playback ───────────────────── */}
      <div className="space-y-10 lg:hidden">
        {WORKFLOW.map((item, i) => {
          const config = SCREENS[item.id]!;
          const Screen = config.Screen;
          return (
            <Reveal key={item.id} variant={i % 2 === 0 ? "zoom-in" : "zoom-out"} duration={700}>
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{item.eyebrow}</p>
                <h3 className="mt-1 text-[20px] font-extrabold leading-tight tracking-tight text-ink">{item.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.body}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sage px-3 py-1.5 text-[11px] font-bold text-sage-ink">
                  <Sparkles className="h-3.5 w-3.5" />
                  {item.outcome}
                </p>
              </div>
              <LoopPlayer steps={config.script + 1} interval={1500}>
                {(step) => (
                  <AppFrame active={config.active} badges={{ documents: 9, compliance: 7, invoices: 4 }}>
                    <Screen step={step} />
                  </AppFrame>
                )}
              </LoopPlayer>
            </Reveal>
          );
        })}
      </div>
    </>
  );
}
