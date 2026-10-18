export default function Loading() {
  return (
    <div className="animate-fade space-y-4">
      <div className="h-8 w-64 animate-pulse rounded-full bg-black/[0.06]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-28 animate-pulse bg-white/70" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card h-64 animate-pulse bg-white/70 lg:col-span-2" />
        <div className="card h-64 animate-pulse bg-white/70" />
      </div>
    </div>
  );
}
