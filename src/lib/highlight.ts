import "server-only";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubLight from "@shikijs/themes/github-light";
import githubDark from "@shikijs/themes/github-dark-default";
import { getLang } from "./langs";

export const THEMES = { light: "github-light", dark: "github-dark-default" } as const;

/** Maximum bytes we highlight on the server; larger pastes render as plain text to keep TTFB low. */
export const HIGHLIGHT_MAX_BYTES = 200 * 1024;

declare global {
  var __highlighter: Promise<HighlighterCore> | undefined;
}

function getHighlighter(): Promise<HighlighterCore> {
  globalThis.__highlighter ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return globalThis.__highlighter;
}

const loading = new Map<string, Promise<void>>();

async function ensureLang(hl: HighlighterCore, shikiId: string): Promise<boolean> {
  if (hl.getLoadedLanguages().includes(shikiId)) return true;
  let p = loading.get(shikiId);
  if (!p) {
    p = import(`@shikijs/langs/${shikiId}`)
      .then((mod) => hl.loadLanguage(mod.default))
      .catch((err) => {
        console.warn(`[highlight] failed to load grammar ${shikiId}`, err);
      });
    loading.set(shikiId, p);
  }
  await p;
  return hl.getLoadedLanguages().includes(shikiId);
}

export type HighlightedLine = string; // HTML for the inside of one line

/**
 * Returns one HTML string per source line so the viewer can render its own
 * gutter, line anchors and selection without fighting shiki's <pre>.
 */
export async function highlightLines(code: string, langId: string): Promise<{ lines: HighlightedLine[]; highlighted: boolean }> {
  const lang = getLang(langId);
  const shikiId = lang?.shiki;
  const plain = () => ({ lines: code.split("\n").map(escapeHtml), highlighted: false });
  if (!shikiId) return plain();
  if (Buffer.byteLength(code, "utf8") > HIGHLIGHT_MAX_BYTES) return plain();

  const hl = await getHighlighter();
  if (!(await ensureLang(hl, shikiId))) return plain();

  const { tokens } = hl.codeToTokens(code, {
    lang: shikiId,
    themes: THEMES,
    defaultColor: false,
  });
  const lines = tokens.map((line) =>
    line
      .map((t) => {
        const style = t.htmlStyle
          ? Object.entries(t.htmlStyle)
              .map(([k, v]) => `${k}:${v}`)
              .join(";")
          : "";
        return style ? `<span style="${style}">${escapeHtml(t.content)}</span>` : escapeHtml(t.content);
      })
      .join(""),
  );
  return { lines, highlighted: true };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
