"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A toggle that reads as a chip: icon plus a short visible label, filled when on.
 * `label` is the accessible name (kept stable for tests); `children` is what people see.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
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
