"use client";

import { useEffect, type ReactNode } from "react";

/** Modal shell: dimmed backdrop, escape to close, click-outside to close. */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Without this the backdrop's handler fires for clicks inside.
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-[6px] border border-edge bg-panel shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-edge bg-bar px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] font-semibold tracking-[0.14em]">
              {title}
            </span>
            {subtitle && (
              <span className="font-mono text-[10px] text-muted-3">
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer px-1 font-mono text-sm text-muted transition hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Labelled form field. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] tracking-[0.14em] text-muted-2">
        {label}
      </span>
      {children}
      {hint && (
        <span className="font-mono text-[9px] text-muted-4">{hint}</span>
      )}
    </label>
  );
}

const INPUT_CLASS =
  "w-full rounded-[3px] border border-edge bg-inset px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none transition focus:border-accent-edge tnum";

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={INPUT_CLASS} />;
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return <select {...props} className={INPUT_CLASS} />;
}

/** Full-width action button for dialog footers. */
export function DialogButton({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const variants = {
    primary:
      "border-accent-edge bg-accent-bg text-accent-bright hover:brightness-125",
    ghost: "border-edge-strong bg-transparent text-muted hover:text-ink",
    danger: "border-down-edge bg-down-bg text-down-bright hover:brightness-125",
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 cursor-pointer rounded-[3px] border px-3 py-2 font-mono text-[10px] font-semibold tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
