"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Editor } from "./editor";

const FORK_KEY = "paster:fork";

export function stashFork(data: { content: string; title?: string; lang?: string }) {
  try {
    sessionStorage.setItem(FORK_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// Read the stash once per mount (sticky so removing it doesn't reset the editor).
let stash: string | null | undefined;
function readStash(): string | null {
  if (stash === undefined) {
    try {
      stash = sessionStorage.getItem(FORK_KEY);
      if (stash) sessionStorage.removeItem(FORK_KEY);
    } catch {
      stash = null;
    }
  }
  return stash;
}

/** Home page editor; picks up a "fork" handed over from a paste view via sessionStorage. */
export function NewPaste() {
  const raw = useSyncExternalStore(
    () => () => {},
    readStash,
    () => null,
  );
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  useEffect(() => () => void (stash = undefined), []);

  const initial = useMemo(() => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as { content: string; title?: string; lang?: string };
    } catch {
      return undefined;
    }
  }, [raw]);

  // Wait for hydration so a fork doesn't flash an empty textarea first.
  if (!mounted) return <div className="flex-1" />;
  return <Editor initial={initial} />;
}
