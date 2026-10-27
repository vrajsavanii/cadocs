import * as React from "react";
import { avatarTone, initials } from "@/lib/format";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{eyebrow}</p> : null}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "soft" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/30";

const buttonVariants: Record<string, string> = {
  primary: "bg-green text-white hover:bg-green-dark shadow-[0_6px_18px_-8px_rgba(59,82,68,0.6)]",
  secondary: "bg-white text-ink border border-black/10 hover:border-black/20 hover:bg-subtle",
  ghost: "text-muted hover:text-ink hover:bg-black/[0.04]",
  soft: "bg-sage text-sage-ink hover:bg-[#dce8de]",
  danger: "bg-[#B4433A] text-white hover:bg-[#9d3a32]",
};

const buttonSizes: Record<string, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
  icon: "h-9 w-9",
};

/**
 * Button styling as a function, so links (`<a>`) elsewhere — the public site,
 * for instance — render the exact same button as the application.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes; className?: string } = {}) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({ variant = "primary", size = "md", className, children, loading, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonClasses({ variant, size, className })} disabled={disabled || loading} {...props}>
      {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-[#E8F2EA] text-[#2F6B3F]",
  sage: "bg-sage text-sage-ink",
  amber: "bg-[#FBF1DF] text-[#8A6420]",
  red: "bg-[#FBEAE7] text-[#A33B2E]",
  blue: "bg-[#E9F0F9] text-[#335C8A]",
  purple: "bg-[#EFEAF8] text-[#5B468F]",
  neutral: "bg-black/[0.05] text-[#5C635E]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof badgeTones;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

const statusTone: Record<string, keyof typeof badgeTones> = {
  Filed: "green",
  Paid: "green",
  Verified: "green",
  Approved: "green",
  Won: "green",
  Active: "green",
  Closed: "green",
  Accepted: "green",
  Ready: "blue",
  Draft: "neutral",
  "Response Filed": "blue",
  "Partially Paid": "amber",
  Received: "blue",
  Waived: "neutral",
  Sent: "blue",
  Pending: "amber",
  "In Progress": "amber",
  New: "amber",
  Contacted: "blue",
  Qualified: "purple",
  "Proposal Sent": "purple",
  Hot: "red",
  Warm: "amber",
  Cold: "blue",
  Overdue: "red",
  Expired: "red",
  Escalated: "red",
  Rejected: "red",
  Lost: "red",
  Declined: "red",
  Revoked: "red",
  Open: "red",
  "Expiring Soon": "amber",
  Cancelled: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone[status] ?? "neutral";
  return (
    <Badge tone={tone}>
      <span className={cn("h-1.5 w-1.5 rounded-full", tone === "green" ? "bg-[#3E8A52]" : tone === "red" ? "bg-[#C0503F]" : tone === "amber" ? "bg-[#B98028]" : tone === "blue" ? "bg-[#3F6FA8]" : tone === "purple" ? "bg-[#7358B5]" : "bg-black/30")} />
      {status}
    </Badge>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold", avatarTone(name), className)}>
      {initials(name)}
    </span>
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-sage text-sage-ink">{icon}</div> : null}
      <p className="text-sm font-bold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Progress({ value, tone = "green" }: { value: number; tone?: "green" | "amber" | "red" }) {
  const colors = { green: "bg-green", amber: "bg-[#C99235]", red: "bg-[#C0503F]" };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
      <div className={cn("h-full rounded-full transition-all duration-500", colors[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-muted", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 text-sm text-ink", className)}>{children}</td>;
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "sage",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "sage" | "gold" | "blue" | "rose";
}) {
  const tones = {
    sage: "bg-sage text-sage-ink",
    gold: "bg-gold-soft text-gold",
    blue: "bg-[#E9F0F9] text-[#335C8A]",
    rose: "bg-[#FBEAE7] text-[#A33B2E]",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
          <p className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-ink">{value}</p>
          {hint ? <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p> : null}
        </div>
        {icon ? <span className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", tones[tone])}>{icon}</span> : null}
      </div>
    </Card>
  );
}
