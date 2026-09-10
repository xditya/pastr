"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A toggle. As a chip (default) it reads as an icon plus a short label, filled when on, and
 * `label` is its accessible name (kept stable for tests). As a row it is a full-width settings
 * line, the shape phones expect inside a sheet: the visible text names it and `hint` describes it.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
  children,
  appearance = "chip",
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
  appearance?: "chip" | "row";
  hint?: string;
}) {
  const hintId = useId();
  const shared = { id, type: "button" as const, role: "switch", "aria-checked": checked, disabled, onClick: () => onChange(!checked) };
  if (appearance === "row") {
    return (
      <button
        {...shared}
        aria-describedby={hint ? hintId : undefined}
        className={cn("flex w-full items-center justify-between gap-4 py-3 text-left transition-colors active:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50", className)}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-medium text-fg">{children}</span>
          {hint && (
            <span id={hintId} className="text-[12.5px] text-fg-muted">
              {hint}
            </span>
          )}
        </span>
        <span aria-hidden className={cn("relative h-[26px] w-11 shrink-0 rounded-full transition-colors duration-200 ease-quint", checked ? "bg-accent" : "bg-border-strong")}>
          <span className={cn("absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-quint", checked && "translate-x-[18px]")} />
        </span>
      </button>
    );
  }
  return (
    <button
      {...shared}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-fg bg-fg text-bg" : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}
