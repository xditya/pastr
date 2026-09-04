"use client";

import { cn } from "@/lib/cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50",
        checked ? "border-fg bg-fg" : "border-border-strong bg-surface-2",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 size-3.5 rounded-full transition-transform duration-150",
          checked ? "translate-x-4 bg-bg" : "translate-x-0 bg-fg-faint",
        )}
      />
    </button>
  );
}
