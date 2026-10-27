"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/components/ui";

type AiBadgeProps = {
  visible?: boolean;
};

export function AiBadge({ visible = true }: AiBadgeProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !visible) return null;

  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full border border-ink/10 bg-ink/5 px-3 py-1 text-[11px] font-semibold text-ink")}>
      <Sparkles className="h-3.5 w-3.5 text-[#B1832F]" />
      <span>AI copilot in every workspace</span>
    </div>
  );
}
