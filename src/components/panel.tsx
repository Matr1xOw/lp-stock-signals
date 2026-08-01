import type { ReactNode } from "react";

/**
 * The panel chrome every section of the desk shares: a bordered surface with
 * a title bar of fixed height, and a body that scrolls on its own.
 */
export function Panel({
  title,
  badge,
  actions,
  children,
  className = "",
}: {
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-[5px] border border-edge bg-panel ${className}`}
    >
      <div className="flex h-[34px] flex-none items-center gap-2.5 border-b border-edge bg-bar px-3">
        <span className="font-mono text-[10px] font-semibold tracking-[0.16em]">
          {title}
        </span>
        {badge}
        <div className="flex-1" />
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Small pill used for counts and states in panel headers. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "up" | "down";
}) {
  const tones = {
    neutral: "bg-track text-muted-2",
    accent: "bg-accent-bg text-accent-bright",
    up: "bg-up-bg text-up-dim",
    down: "bg-down-bg text-down-bright",
  } as const;

  return (
    <span
      className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Uppercase micro-label used above every value on the desk. */
export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-[9px] tracking-[0.14em] text-muted-2 ${className}`}
    >
      {children}
    </span>
  );
}

/** Terminal-style button. */
export function DeskButton({
  children,
  onClick,
  variant = "ghost",
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ghost" | "primary" | "danger";
  title?: string;
  disabled?: boolean;
}) {
  const variants = {
    ghost:
      "border-edge-strong bg-transparent text-muted hover:border-edge-hover hover:text-ink-soft",
    primary:
      "border-accent-edge bg-accent-bg font-semibold text-accent-bright hover:brightness-125",
    danger:
      "border-down-edge bg-down-bg text-down-bright hover:brightness-125",
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`cursor-pointer rounded-[2px] border px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
