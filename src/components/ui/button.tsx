import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const base =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[background-color,border-color,color,opacity,transform] duration-200 ease-quint active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

const variants: Record<Variant, string> = {
  primary: "border-fg bg-fg text-bg hover:border-accent hover:bg-accent hover:text-accent-fg",
  secondary: "border-border bg-surface text-fg hover:border-accent",
  ghost: "border-transparent bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "border-transparent bg-transparent text-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12.5px]",
  md: "h-8 px-3 text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading && <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
});

/** Class string for anchor elements that should look like a Button. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { className, label, variant = "ghost", size = "md", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], size === "sm" ? "size-7" : "size-8", "px-0", className)}
      {...props}
    >
      {children}
    </button>
  );
});
