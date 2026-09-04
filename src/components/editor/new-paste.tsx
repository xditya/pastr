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

/**
 * Home page editor. The form is server-rendered so it works without JavaScript;
 * a "fork" handed over via sessionStorage remounts it with the forked content.
 */
export function NewPaste({ maxBytes }: { maxBytes: number }) {
  const raw = useSyncExternalStore(
    () => () => {},
    readStash,
    () => null,
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

  return <Editor key={initial ? "fork" : "new"} initial={initial} maxBytes={maxBytes} />;
}
