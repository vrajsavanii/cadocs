import { compactInr } from "@/lib/format";

export function RevenueChart({ data }: { data: Array<{ month: string; billed: number; collected: number }> }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.billed, d.collected)));
  return (
    <div>
      <div className="flex h-[190px] items-end gap-3 sm:gap-5">
        {data.map((d) => (
          <div key={d.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div
                className="relative w-1/2 max-w-[22px] rounded-t-md bg-[#D9E4DA] transition-all duration-500 group-hover:bg-[#C9D9CB]"
                style={{ height: `${Math.max(3, (d.billed / max) * 100)}%` }}
                title={`Billed ${compactInr(d.billed)}`}
              >
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] font-semibold text-white group-hover:block">
                  {compactInr(d.billed)}
                </span>
              </div>
              <div
                className="w-1/2 max-w-[22px] rounded-t-md bg-green transition-all duration-500 group-hover:bg-green-dark"
                style={{ height: `${Math.max(3, (d.collected / max) * 100)}%` }}
                title={`Collected ${compactInr(d.collected)}`}
              />
            </div>
            <span className="text-[10px] font-semibold text-muted">{d.month}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 text-[11px] font-semibold text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#D9E4DA]" /> Billed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-green" /> Collected
        </span>
      </div>
    </div>
  );
}

export function FeeGauge({ rate, collected, billed }: { rate: number; collected: number; billed: number }) {
  const clamped = Math.min(100, Math.max(0, rate));
  const angle = (clamped / 100) * Math.PI;
  const endX = 80 - 65 * Math.cos(angle);
  const endY = 85 - 65 * Math.sin(angle);
  const d = `M 15 85 A 65 65 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 160 100" className="w-full max-w-[240px]" role="img" aria-label={`Collection rate ${clamped}%`}>
        <path d="M 15 85 A 65 65 0 0 1 145 85" fill="none" stroke="#E6E4DF" strokeWidth="11" strokeLinecap="round" />
        <path d={d} fill="none" stroke="#3B5244" strokeWidth="11" strokeLinecap="round" />
        <text x="80" y="76" textAnchor="middle" className="fill-ink" style={{ fontSize: 22, fontWeight: 800 }}>
          {clamped}%
        </text>
        <text x="80" y="92" textAnchor="middle" style={{ fill: "#7C847E", fontSize: 8, fontWeight: 600, letterSpacing: 1 }}>
          RECOVERED
        </text>
      </svg>
      <div className="mt-1 grid w-full grid-cols-2 gap-3 text-center">
        <div className="rounded-2xl bg-subtle px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Billed</p>
          <p className="mt-0.5 text-sm font-extrabold text-ink">{compactInr(billed)}</p>
        </div>
        <div className="rounded-2xl bg-sage px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sage-ink/70">Collected</p>
          <p className="mt-0.5 text-sm font-extrabold text-sage-ink">{compactInr(collected)}</p>
        </div>
      </div>
    </div>
  );
}

export function PipelineBars({ data }: { data: Array<{ status: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.status}>
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
            <span className="text-muted">{d.status}</span>
            <span className="text-ink">{d.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/[0.05]">
            <div className="h-full rounded-full bg-green/80 transition-all duration-500" style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
