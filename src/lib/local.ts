"use client";

/**
 * Browser-only persistence. Nothing here is ever sent to the server.
 * - "your pastes": ids + edit tokens + decryption keys so Edit/Delete never prompt for tokens
 * - preferences: default expiry/lang, wrap, font size
 */

export type LocalPaste = {
  id: string;
  title?: string;
  lang: string;
  created: number;
  expires: number | null;
  burn: boolean;
  editToken?: string;
  /** URL fragment key for encrypted pastes (never the password). */
  key?: string;
  encrypted: boolean;
};

export type Prefs = {
  expiry: string;
  lang: string;
  wrap: boolean;
  encryptByDefault: boolean;
};

const PASTES_KEY = "paster:pastes";
const PREFS_KEY = "paster:prefs";
const MAX_LOCAL = 200;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("paster:local"));
  } catch {
    /* quota / private mode */
  }
}

export function getLocalPastes(): LocalPaste[] {
  const now = Date.now();
  return read<LocalPaste[]>(PASTES_KEY, []).filter((p) => p.expires === null || p.expires > now);
}

export function getLocalPaste(id: string): LocalPaste | undefined {
  return getLocalPastes().find((p) => p.id === id);
}

export function rememberPaste(p: LocalPaste) {
  const list = getLocalPastes().filter((x) => x.id !== p.id);
  list.unshift(p);
  write(PASTES_KEY, list.slice(0, MAX_LOCAL));
}

export function forgetPaste(id: string) {
  write(
    PASTES_KEY,
    getLocalPastes().filter((x) => x.id !== id),
  );
}

export function updateLocalPaste(id: string, patch: Partial<LocalPaste>) {
  const list = getLocalPastes().map((x) => (x.id === id ? { ...x, ...patch } : x));
  write(PASTES_KEY, list);
}

export const DEFAULT_PREFS: Prefs = { expiry: "7d", lang: "auto", wrap: false, encryptByDefault: false };

export function getPrefs(): Prefs {
  return { ...DEFAULT_PREFS, ...read<Partial<Prefs>>(PREFS_KEY, {}) };
}

export function setPrefs(patch: Partial<Prefs>) {
  write(PREFS_KEY, { ...getPrefs(), ...patch });
}

/** Subscribe to changes made by this tab or others. */
export function onLocalChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("paster:local", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("paster:local", cb);
    window.removeEventListener("storage", cb);
  };
}
