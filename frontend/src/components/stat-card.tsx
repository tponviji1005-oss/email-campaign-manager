import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  suffix?: string;
  tone?: "primary" | "success" | "warning" | "danger" | "neutral";
  loading?: boolean;
  decimals?: number;
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

function useCounter(target: number, active: boolean, decimals: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const duration = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Number((target * eased).toFixed(decimals)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, decimals]);

  return value;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  suffix,
  tone = "primary",
  loading,
  decimals = 0,
}: StatCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const counted = useCounter(value, inView && !loading, decimals);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-lift)]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-muted-foreground">{label}</p>
        <span
          className={cn("grid size-10 shrink-0 place-items-center rounded-xl", toneClasses[tone])}
        >
          <Icon className="size-5" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-foreground">
        {loading ? (
          <span className="inline-block h-8 w-24 animate-pulse rounded-md bg-muted align-middle" />
        ) : (
          <>
            {decimals ? counted.toFixed(decimals) : Math.round(counted).toLocaleString()}
            {suffix}
          </>
        )}
      </p>
    </motion.div>
  );
}
