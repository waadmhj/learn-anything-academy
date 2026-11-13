"use client";

import clsx from "clsx";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Status } from "@/lib/types";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover shadow-[var(--shadow)]",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "secondary", className, children }: { href: string; variant?: Variant; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors whitespace-nowrap", VARIANTS[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) {
  return <As className={cn("rounded-xl border border-border bg-surface shadow-[var(--shadow)]", className)}>{children}</As>;
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-fg-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "mastered";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-2 border-border",
  accent: "bg-accent-soft text-accent-text border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  mastered: "bg-mastered-soft text-mastered border-transparent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export const STATUS_META: Record<Status, { label: string; tone: Tone; dot: string }> = {
  not_started: { label: "Not started", tone: "neutral", dot: "bg-border-strong" },
  in_progress: { label: "In progress", tone: "info", dot: "bg-info" },
  completed: { label: "Completed", tone: "success", dot: "bg-success" },
  needs_revision: { label: "Needs revision", tone: "warning", dot: "bg-warning" },
  mastered: { label: "Mastered", tone: "mastered", dot: "bg-mastered" },
};

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_META[status].dot, className)} aria-label={STATUS_META[status].label} />;
}

export function ProgressBar({ value, tone = "accent", className, label }: { value: number; tone?: "accent" | "success" | "mastered" | "warning"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = { accent: "bg-accent", success: "bg-success", mastered: "bg-mastered", warning: "bg-warning" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2 border border-border/60", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums">{label ?? `${Math.round(pct)}%`}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <div className="mb-3 text-fg-3">{icon ?? <Inbox className="size-6" />}</div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-fg-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="flex-1">
        <p className="font-medium text-danger">Something went wrong</p>
        <p className="mt-0.5 text-fg-2">{error?.message}</p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium text-fg-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-fg-3">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition-colors", value === it.value ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-fg-2 hover:text-fg")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const levelTone = (l: string): Tone => (l === "beginner" ? "success" : l === "intermediate" ? "info" : "mastered");
