import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Phone-only action bar pinned to the bottom of the screen (hidden from sm up), the way
 * native apps keep primary actions under the thumb. Its buttons need JavaScript, so it stays
 * hidden until the theme script marks <html class="js">; pages that render one pad <main>
 * with `pb-bar` so nothing hides behind it.
 */
export function MobileBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-bg/90 px-inset pb-[var(--safe-b)] backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:hidden [html:not(.js)_&]:hidden">
      {children}
    </nav>
  );
}

const item =
  "flex h-14 min-w-0 flex-1 select-none flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-muted transition-colors active:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 aria-expanded:text-fg aria-pressed:text-fg";

export function BarButton({ icon, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return (
    <button type="button" className={cn(item, className)} {...props}>
      <span className="flex size-6 items-center justify-center">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

export function BarLink({ icon, children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { icon: ReactNode }) {
  return (
    <a className={cn(item, className)} {...props}>
      <span className="flex size-6 items-center justify-center">{icon}</span>
      <span className="truncate">{children}</span>
    </a>
  );
}
