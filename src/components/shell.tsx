import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "@/lib/config";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocalPastesMenu } from "@/components/local-pastes-menu";

/** App chrome: a slim top bar and a content slot that fills the viewport. */
export function Shell({ children, actions, wide }: { children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
        <div className={`mx-auto flex h-12 items-center gap-3 px-4 ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>
          <Link href="/" className="flex items-center gap-2 rounded-md text-[14px] font-semibold tracking-tight text-fg" aria-label={`${SITE.name} home`}>
            <Logo className="size-5" />
            <span>{SITE.name}</span>
          </Link>
          <nav className="ml-1 hidden items-center gap-0.5 sm:flex" aria-label="Primary">
            <Link href="/" className="rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              New
            </Link>
            <Link href="/docs" className="rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg">
              API
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {actions}
            <LocalPastesMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={`mx-auto flex w-full flex-1 flex-col px-4 ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>{children}</main>
      <footer className="border-t border-border">
        <div className={`mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px] text-fg-faint ${wide ? "max-w-[1400px]" : "max-w-6xl"}`}>
          <span>{SITE.name}</span>
          <span aria-hidden>·</span>
          <Link href="/docs" className="hover:text-fg">
            API &amp; CLI
          </Link>
          <span aria-hidden>·</span>
          <a href={SITE.repo} className="hover:text-fg" rel="noopener noreferrer" target="_blank">
            Source
          </a>
          <span className="ml-auto">No ads. No accounts. No tracking.</span>
        </div>
      </footer>
    </div>
  );
}
