"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./button";

/** Small modal built on the native <dialog> element. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>("[autofocus], [data-autofocus]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-xl border border-border bg-surface p-0 text-fg shadow-pop backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-[14px] font-semibold">
          {title}
        </h2>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="px-4 py-4">{children}</div>
    </dialog>
  );
}
