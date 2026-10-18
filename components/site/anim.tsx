"use client";

/**
 * Animation primitives for the public site.
 *
 * Deliberately dependency-free: IntersectionObserver + CSS transitions cover
 * every effect (reveals, zoom in/out, counters, typing). Everything honours
 * `prefers-reduced-motion` — the global stylesheet already collapses
 * transitions for those users, and these hooks skip their own timers.
 */
import * as React from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Runs exactly one callback on the next animation frame — or on a short timer if
 * no frame arrives (background tabs, stalled compositors, headless rendering).
 * Without this, every rAF-driven counter and scroll handler silently freezes on
 * machines whose rendering pipeline is paused.
 */
export function scheduleTick(fn: () => void): () => void {
  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    fn();
  };
  const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : 0;
  const timer = setTimeout(run, 90);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(REDUCED_QUERY);
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Fires once when the element scrolls into view. */
export function useInView<T extends HTMLElement = HTMLDivElement>(options?: {
  once?: boolean;
  margin?: string;
  threshold?: number;
}) {
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);
  const once = options?.once ?? true;
  const margin = options?.margin ?? "0px 0px -10% 0px";
  const threshold = options?.threshold ?? 0.15;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Manual fallback: some environments (paused compositors, headless frames)
    // never deliver IntersectionObserver callbacks, which would leave every
    // reveal and counter frozen. Measure by hand instead.
    const measure = () => {
      const box = el.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const topEdge = viewport * (1 + parseFloat(margin.split(" ")[2] || "0") / 100);
      if (box.top < topEdge && box.bottom > 0) setInView(true);
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) io?.disconnect();
          } else if (!once) {
            setInView(false);
          }
        },
        { rootMargin: margin, threshold },
      );
      io.observe(el);
    }

    const onScroll = () => measure();
    const timer = setTimeout(measure, 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      io?.disconnect();
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [once, margin, threshold, inView]);

  return { ref, inView };
}

export type RevealVariant = "rise" | "zoom-in" | "zoom-out" | "fade" | "left" | "right";

const HIDDEN: Record<RevealVariant, string> = {
  rise: "translate3d(0, 26px, 0)",
  "zoom-in": "scale(0.88)",
  "zoom-out": "scale(1.1)",
  fade: "none",
  left: "translate3d(-18px, 0, 0)",
  right: "translate3d(18px, 0, 0)",
};

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Scroll reveal. `zoom-in` grows into place, `zoom-out` settles down from a
 * slightly enlarged state — the two halves of the "lens" effect between
 * sections.
 */
export function Reveal({
  children,
  variant = "rise",
  delay = 0,
  duration = 760,
  className,
  style,
}: {
  children: React.ReactNode;
  variant?: RevealVariant;
  delay?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>();
  const shown = inView || reduced;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : HIDDEN[variant],
        transition: reduced
          ? undefined
          : `opacity ${duration}ms ${EASE} ${delay}ms, transform ${duration}ms ${EASE} ${delay}ms`,
        willChange: shown ? undefined : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/** Counts up to `to` when scrolled into view. */
export function Counter({
  to,
  duration = 1500,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  to: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setValue(to);
      return;
    }
    let cancel: (() => void) | null = null;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) cancel = scheduleTick(() => tick(performance.now()));
    };
    cancel = scheduleTick(() => tick(performance.now()));
    return () => cancel?.();
  }, [inView, reduced, to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/** Types text out character by character when visible. */
export function Typing({
  text,
  speed = 16,
  startDelay = 0,
  className,
  onDone,
}: {
  text: string;
  speed?: number;
  startDelay?: number;
  className?: string;
  onDone?: () => void;
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.2 });
  const [shown, setShown] = React.useState(0);
  const done = React.useRef(onDone);
  done.current = onDone;

  React.useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(text.length);
      done.current?.();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    if (shown === 0) {
      timer = setTimeout(() => setShown(1), startDelay);
      return () => clearTimeout(timer);
    }
    if (shown >= text.length) {
      done.current?.();
      return;
    }
    timer = setTimeout(() => setShown((n) => n + 1), speed);
    return () => clearTimeout(timer);
  }, [inView, reduced, shown, text.length, speed, startDelay]);

  return (
    <span ref={ref} className={className}>
      {text.slice(0, shown)}
      {shown > 0 && shown < text.length ? <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-current align-middle" /> : null}
    </span>
  );
}

/**
 * Cycles a step index every `interval` ms while the owned element is on
 * screen — the timing engine behind the animated product screens. Returns the
 * ref to attach plus the current step (0 while off screen).
 */
export function useLoop(steps: number, interval: number, enabled = true) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ once: false, threshold: 0.2 });
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || reduced || !inView) return;
    const id = setInterval(() => setStep((s) => (s + 1) % steps), interval);
    return () => clearInterval(id);
  }, [enabled, reduced, inView, steps, interval]);

  React.useEffect(() => {
    if (!inView) setStep(0);
  }, [inView]);

  return { ref, step: enabled ? step : 0, active: inView };
}

/**
 * Design-tool canvas: renders a screen at a fixed desktop design width and
 * scales it to the space available, so every mock keeps the exact layout it has
 * inside the application instead of reflowing into something unfamiliar.
 * Below `lg` the mock is left fluid — a scaled-down desktop UI would be
 * unreadable on a phone, and the app is responsive anyway.
 */
export function FitBox({
  width,
  className,
  children,
}: {
  width: number;
  className?: string;
  children: React.ReactNode;
}) {
  const outer = React.useRef<HTMLDivElement | null>(null);
  const inner = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [height, setHeight] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    const measure = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const next = desktop ? Math.min(1, o.clientWidth / width) : 1;
      setScale(next);
      setHeight(next < 1 ? i.offsetHeight * next : undefined);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width]);

  return (
    <div ref={outer} className={className} style={{ height }}>
      <div
        ref={inner}
        style={
          {
            width: scale < 1 ? width : "100%",
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
            // Children (the action cursor) need the live scale to convert
            // viewport coordinates back into frame-local pixels.
            "--fit-scale": String(scale),
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

export { useInView as useVisibility };
