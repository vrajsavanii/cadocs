export function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function compactInr(amount: number): string {
  const n = Number(amount) || 0;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}

export function dayDiff(dateStr: string): number {
  if (!dateStr) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function prettyDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function shortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function relativeDeadline(dateStr: string): string {
  const days = dayDiff(dateStr);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return `Due in ${days} days`;
  if (days === -1) return "1 day overdue";
  return `${Math.abs(days)} days overdue`;
}

export function whatsappLink(phone: string, message: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const avatarPalette = [
  "bg-[#E8EFE9] text-[#3D5445]",
  "bg-[#F4EDE0] text-[#8A6A34]",
  "bg-[#E7EDF5] text-[#3F5875]",
  "bg-[#F3E9E7] text-[#7C4A3F]",
  "bg-[#EDE9F4] text-[#574A78]",
];

export function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return avatarPalette[hash % avatarPalette.length];
}
