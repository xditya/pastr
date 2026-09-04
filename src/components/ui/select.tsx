import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        ref={ref}
        className="h-8 w-full cursor-pointer appearance-none rounded-md border border-border bg-surface pl-2.5 pr-7 text-[13px] text-fg transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" aria-hidden />
    </span>
  );
});
