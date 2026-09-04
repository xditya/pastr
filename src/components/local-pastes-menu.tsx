"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { History, Lock, Flame, Trash2 } from "lucide-react";
import { forgetPaste } from "@/lib/local";
import { useLocalPastes } from "@/hooks/use-local";
import { formatRelative } from "@/lib/expiry";
import { IconButton } from "@/components/ui/button";

/** "Your pastes": recent pastes from this browser, with their edit tokens kept locally. */
export function LocalPastesMenu() {
  const [open, setOpen] = useState(false);
  const pastes = useLocalPastes();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton label="Your pastes" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <History className="size-4" />
        {pastes.length > 0 && <span className="sr-only">{pastes.length} saved</span>}
      </IconButton>
      {open && (
        <div
          role="menu"
          className="animate-fade-up absolute right-0 top-full mt-1.5 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[12px] font-medium text-fg-muted">Your pastes</span>
            <span className="text-[11px] text-fg-faint">stored in this browser only</span>
          </div>
          {pastes.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-fg-faint">Pastes you create will show up here.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {pastes.map((p) => (
                <li key={p.id} className="group flex items-center gap-2 px-2 py-1">
                  <Link
                    href={`/${p.id}${p.key ? `#${p.key}` : ""}`}
                    onClick={() => setOpen(false)}
                    className="flex min-w-0 flex-1 flex-col rounded-md px-1.5 py-1 hover:bg-surface-2"
                    role="menuitem"
                  >
                    <span className="flex items-center gap-1.5 truncate text-[13px]">
                      {p.encrypted && <Lock className="size-3 shrink-0 text-fg-faint" aria-label="encrypted" />}
                      {p.burn && <Flame className="size-3 shrink-0 text-warning" aria-label="burn after read" />}
                      <span className="truncate">{p.title || <span className="font-mono text-fg-muted">{p.id}</span>}</span>
                    </span>
                    <span className="truncate text-[11px] text-fg-faint">
                      {p.lang !== "text" ? `${p.lang} · ` : ""}
                      {formatRelative(p.created)}
                      {p.expires ? ` · expires ${formatRelative(p.expires)}` : ""}
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label="Forget this paste"
                    title="Forget (removes from this list only)"
                    onClick={() => forgetPaste(p.id)}
                    className="rounded-md p-1 text-fg-faint opacity-0 hover:bg-surface-2 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
