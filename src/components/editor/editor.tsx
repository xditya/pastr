"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { ClipboardPaste, Flame, ImageIcon, KeyRound, Lock, Save, ShieldAlert, Upload, X } from "lucide-react";
import { findSecrets } from "@/lib/secrets";
import { DEFAULT_EXPIRY, EXPIRIES, LIMITS } from "@/lib/config";
import { base64Bytes, byteLength, formatBytes } from "@/lib/bytes";
import { detectLang } from "@/lib/detect";
import { LANGS, imageMime, langFromFilename, langFromMime } from "@/lib/langs";
import { extractLink, linkHost } from "@/lib/links";
import { encryptEnvelope, reencryptEnvelope } from "@/lib/crypto";
import type { EncryptionMeta } from "@/lib/paste";
import { api, ApiError } from "@/lib/client";
import { rememberPaste, setPrefs, updateLocalPaste } from "@/lib/local";
import { useHotkeys, isMac } from "@/hooks/use-hotkeys";
import { useMounted, usePrefs } from "@/hooks/use-local";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

const POPULAR = ["text", "markdown", "javascript", "typescript", "python", "go", "rust", "json", "yaml", "shellscript", "html", "css", "sql", "java", "c", "cpp"];
const NUL = String.fromCharCode(0);

export type EditTarget = {
  id: string;
  editToken: string;
  content: string;
  title?: string;
  lang: string;
  enc?: EncryptionMeta;
  secret?: { fragment: string } | { password: string };
  expires: number | null;
  burn: boolean;
};

export type SavedPaste = { id: string; content: string; title?: string; lang: string; enc?: EncryptionMeta };

export type EditorProps = {
  /** When set, the editor updates an existing paste instead of creating a new one. */
  edit?: EditTarget;
  /** Pre-filled content (used by "Fork"). */
  initial?: { content: string; title?: string; lang?: string };
  /** Server-side content limit in bytes (the client bundle can't read MAX_PASTE_BYTES). */
  maxBytes?: number;
  /** Expiry ids the server allows (MAX_EXPIRY policy). */
  expiries?: readonly string[];
  onCancel?: () => void;
  onSaved?: (saved: SavedPaste) => void;
  /** Called when the server rejects the edit token (401/403). */
  onAuthError?: () => void;
};

export function Editor({ edit, initial, maxBytes = LIMITS.maxBytes, expiries, onCancel, onSaved, onAuthError }: EditorProps) {
  const allowedExpiries = useMemo(() => EXPIRIES.filter((e) => !expiries || expiries.includes(e.id)), [expiries]);
  const router = useRouter();
  const { push } = useToast();
  // Saved preferences only apply after hydration so the server-rendered form matches the first client render.
  const mounted = useMounted();
  const prefs = usePrefs();

  const [content, setContent] = useState(edit?.content ?? initial?.content ?? "");
  const [title, setTitle] = useState(edit?.title ?? initial?.title ?? "");
  const [lang, setLang] = useState<string>(edit?.lang ?? initial?.lang ?? "auto");
  const [expiryChoice, setExpiry] = useState<string | null>(null);
  const fallbackExpiry = allowedExpiries.some((e) => e.id === DEFAULT_EXPIRY) ? DEFAULT_EXPIRY : (allowedExpiries[allowedExpiries.length - 1]?.id ?? DEFAULT_EXPIRY);
  const preferredExpiry = allowedExpiries.some((e) => e.id === prefs.expiry) ? prefs.expiry : fallbackExpiry;
  const expiry = expiryChoice ?? (mounted ? preferredExpiry : fallbackExpiry);
  const [burn, setBurn] = useState(false);
  const [encryptChoice, setEncrypt] = useState<boolean | null>(edit ? !!edit.enc : null);
  const encrypt = encryptChoice ?? (mounted ? prefs.encryptByDefault : false);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(edit?.enc?.kdf === "password");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Escape inside the textarea arms this so the next Tab moves focus instead of indenting. */
  const tabMovesFocus = useRef(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const bytes = useMemo(() => byteLength(content), [content]);
  const lines = useMemo(() => (content ? content.split("\n").length : 1), [content]);
  const detected = useMemo(() => (lang === "auto" ? detectLang(content) : lang), [lang, content]);
  /** Set when the content is a base64 image; the "language" then names the format. */
  const image = imageMime(lang);
  /** What the server will actually store: base64url of the JSON envelope plus the GCM tag when encrypting. */
  const effectiveBytes = useMemo(
    () => (encrypt ? Math.ceil((byteLength(JSON.stringify({ title: title.trim() || undefined, lang: detected, content })) + 16) * (4 / 3)) : bytes),
    [encrypt, title, detected, content, bytes],
  );
  const tooLarge = effectiveBytes > maxBytes;
  /** Heuristic scan for credentials so people don't publish keys by accident (never sent anywhere). */
  const secrets = useMemo(() => (edit?.enc || encrypt || image ? [] : findSecrets(content)), [content, encrypt, edit?.enc, image]);
  /** A paste that is exactly one URL becomes a short link (unless it is encrypted or burn-after-read). */
  const link = useMemo(() => (image || edit ? null : extractLink(content)), [content, image, edit]);
  const shortens = !!link && !encrypt && !burn;
  const canSave = content.trim().length > 0 && !tooLarge && !saving && (!encrypt || !usePassword || password.length > 0);
  const dirty = content !== (edit?.content ?? initial?.content ?? "") || title !== (edit?.title ?? initial?.title ?? "");

  // Don't lose an unsaved paste to an accidental tab close.
  useEffect(() => {
    if (!dirty || saving) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty, saving]);

  const cancel = useCallback(() => {
    if (!onCancel) return;
    if (dirty && !window.confirm("Discard your changes?")) return;
    onCancel();
  }, [dirty, onCancel]);

  const gutter = useMemo(
    () =>
      Array.from({ length: lines }, (_, i) => (
        <div key={i} className="px-3">
          {i + 1}
        </div>
      )),
    [lines],
  );

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  };

  const loadFile = useCallback(
    async (file: File) => {
      const img = langFromMime(file.type) ?? langFromFilename(file.name);
      if (img?.mime) {
        if (file.size > LIMITS.maxImageBytes) {
          push("error", `${file.name} is larger than ${formatBytes(LIMITS.maxImageBytes)}, the limit for images`);
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        setContent(btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")));
        setLang(img.id);
        if (!title && file.name !== "image.png") setTitle(file.name);
        return;
      }
      if (file.size > maxBytes) {
        push("error", `${file.name} is larger than ${formatBytes(maxBytes)}`);
        return;
      }
      const text = await file.text();
      if (text.includes(NUL)) {
        push("error", "That looks like a binary file — only text can be pasted.");
        return;
      }
      setContent(text);
      if (!title) setTitle(file.name);
      const l = langFromFilename(file.name);
      if (l) setLang(l.id);
      push("success", `Loaded ${file.name}`);
    },
    [push, title, maxBytes],
  );

  // Only react to file drags; text drags keep the browser's native behaviour.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  /** Ctrl+V with an image on the clipboard (screenshots) loads it like a dropped file. */
  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void loadFile(file);
  };

  /**
   * Rich read (images) first, plain text second; each browser denies a different one
   * (Firefox and Safari only allow read() from their own paste affordance), so one
   * failing must not stop the other from being tried.
   */
  const pasteFromClipboard = async () => {
    let text: string | null = null;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return void loadFile(new File([await item.getType(type)], "image.png", { type }));
        if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
      }
    } catch {
      /* fall through to readText */
    }
    if (text === null) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        textareaRef.current?.focus();
        push("error", `Clipboard access was denied. Press ${mac ? "⌘" : "Ctrl"}+V in the editor instead.`);
        return;
      }
    }
    if (!text) return push("info", "Clipboard is empty");
    setContent((c) => (c ? `${c}\n${text}` : text));
    textareaRef.current?.focus();
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = "";
  };

  /**
   * Tab indents (two spaces), Shift+Tab outdents, multi-line selections indent every line.
   * Edits go through setRangeText so the browser's undo stack survives. Press Escape first
   * to let Tab move focus (an accessibility escape hatch that is announced in the status bar).
   */
  const [tabHint, setTabHint] = useState(false);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === "Escape") {
      tabMovesFocus.current = true;
      setTabHint(true);
      e.stopPropagation();
      return;
    }
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (tabMovesFocus.current) {
      tabMovesFocus.current = false;
      setTabHint(false);
      return; // native focus move
    }
    e.preventDefault();
    const { selectionStart: s, selectionEnd: end, value } = el;
    const selected = value.slice(s, end);
    const apply = (replacement: string, from: number, to: number, mode: "select" | "end") => {
      el.setRangeText(replacement, from, to, mode);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    if (selected.includes("\n") || e.shiftKey) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const block = value.slice(lineStart, end);
      const next = e.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
      apply(next, lineStart, end, "select");
      return;
    }
    apply("  ", s, end, "end");
  };

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const finalLang = lang === "auto" ? detectLang(content) : lang;
      const cleanTitle = title.trim() || undefined;

      if (edit) {
        // ---- update existing paste ----
        let enc: EncryptionMeta | undefined;
        if (edit.enc && edit.secret) {
          const r = await reencryptEnvelope({ title: cleanTitle, lang: finalLang, content }, edit.enc, edit.secret);
          enc = r.meta;
          await api.update(edit.id, edit.editToken, { content: r.ciphertext, enc: r.meta });
        } else {
          await api.update(edit.id, edit.editToken, { content, title: cleanTitle ?? "", lang: finalLang });
        }
        updateLocalPaste(edit.id, { title: cleanTitle, lang: edit.enc ? "text" : finalLang });
        push("success", "Saved");
        onSaved?.({ id: edit.id, content, title: cleanTitle, lang: finalLang, enc });
        return;
      }
      setPrefs({ expiry, encryptByDefault: encrypt });

      // ---- create ----
      let body: Parameters<typeof api.create>[0];
      let fragment: string | undefined;
      if (encrypt) {
        const result = await encryptEnvelope(
          { title: cleanTitle, lang: finalLang, content },
          usePassword ? { mode: "password", password } : { mode: "fragment" },
        );
        fragment = result.fragment;
        body = { content: result.ciphertext, enc: result.meta, expires: expiry, burn };
      } else {
        body = { content, title: cleanTitle, lang: finalLang, expires: expiry, burn };
      }
      const created = await api.create(body);
      rememberPaste({
        id: created.id,
        title: cleanTitle,
        lang: encrypt ? "text" : finalLang,
        created: created.created,
        expires: created.expires,
        burn,
        editToken: created.editToken,
        key: fragment,
        encrypted: encrypt,
      });
      const target = shortens ? `/${created.id}+` : `/${created.id}${fragment ? `#${fragment}` : ""}`;
      onSaved?.({ id: created.id, content, title: cleanTitle, lang: finalLang, enc: body.enc });
      if (shortens && link) push("success", `Short link ready: ${window.location.host}/${created.id} → ${linkHost(link)}`);
      router.push(target);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403) && onAuthError) {
        setSaving(false);
        onAuthError();
        return;
      }
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "failed to save";
      push("error", msg);
      setSaving(false);
    }
  }, [canSave, lang, content, title, expiry, encrypt, edit, push, onSaved, onAuthError, usePassword, password, burn, router, shortens, link]);

  useHotkeys(
    useMemo(
      () => [
        { combo: "mod+s", handler: () => void save() },
        { combo: "mod+enter", handler: () => void save() },
        ...(onCancel ? [{ combo: "escape", handler: cancel }] : []),
      ],
      [save, onCancel, cancel],
    ),
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const mac = mounted && isMac();

  return (
    <form
      method="post"
      action="/api/v1/pastes"
      onSubmit={onSubmit}
      className="flex flex-1 flex-col"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      {/* Title row: what it is, and the one primary action */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          maxLength={LIMITS.maxTitle}
          aria-label="Title"
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-medium placeholder:text-fg-faint hover:border-border focus:border-border-strong focus:bg-bg"
        />
        {onCancel && (
          <Button type="button" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!canSave} loading={saving} title={`Save (${mac ? "⌘" : "Ctrl"}+S)`}>
          <Save className="size-3.5" aria-hidden />
          {edit ? "Save changes" : "Save"}
        </Button>
      </div>

      {/* Options row: uniform 32px chips, labels always visible */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="flex w-full gap-1.5 sm:contents">
        {image ? (
          <span className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg-muted">
            <ImageIcon className="size-3.5 text-fg-faint" aria-hidden />
            {LANGS.find((l) => l.id === lang)?.label}
            <button type="button" onClick={() => { setContent(""); setLang("auto"); }} title="Remove image" aria-label="Remove image" className="rounded p-0.5 hover:bg-surface-2 hover:text-fg">
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ) : (
        <Select name="lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className="min-w-0 flex-1 sm:flex-none">
          <option value="auto">{lang === "auto" && content ? `Auto · ${LANGS.find((l) => l.id === detected)?.label ?? "text"}` : "Auto-detect"}</option>
          <optgroup label="Popular">
            {POPULAR.map((id) => {
              const l = LANGS.find((x) => x.id === id)!;
              return (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              );
            })}
          </optgroup>
          <optgroup label="All languages">
            {LANGS.filter((l) => !POPULAR.includes(l.id) && !l.mime).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </optgroup>
        </Select>
        )}
        {!edit && (
          <Select name="expires" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry" className="min-w-0 flex-1 sm:flex-none">
            {allowedExpiries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id === "never" ? "Never expires" : `Expires in ${e.label}`}
              </option>
            ))}
          </Select>
        )}
        </div>
        {!edit && (
          <>
            <Switch checked={burn} onChange={setBurn} label="Burn after read">
              <Flame className={cn("size-3.5", burn ? "text-warning" : "text-fg-faint")} aria-hidden /> Burn
            </Switch>
            <input type="hidden" name="burn" value={burn ? "true" : "false"} />
          </>
        )}
        <Switch checked={encrypt} onChange={setEncrypt} label="Encrypt in browser" disabled={!!edit}>
          <Lock className={cn("size-3.5", !encrypt && "text-fg-faint")} aria-hidden /> Encrypt
        </Switch>
        {encrypt && !edit && (
          <Switch checked={usePassword} onChange={setUsePassword} label="Protect with a password instead of a link key">
            <KeyRound className={cn("size-3.5", !usePassword && "text-fg-faint")} aria-hidden /> Password
          </Switch>
        )}
        {encrypt && !edit && usePassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="new-password"
            aria-label="Password"
            className="h-8 w-36 rounded-md border border-border bg-bg px-2.5 text-[13px] focus:border-border-strong"
          />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" onClick={pasteFromClipboard} title="Paste from clipboard" aria-label="Paste from clipboard">
            <ClipboardPaste className="size-3.5" aria-hidden /> Clipboard
          </Button>
          <Button type="button" onClick={() => fileRef.current?.click()} title="Open a text file or image" aria-label="Open a text file or image">
            <Upload className="size-3.5" aria-hidden /> File
          </Button>
          <input ref={fileRef} type="file" className="hidden" onChange={onFileInput} accept="text/*,image/png,image/jpeg,image/gif,image/webp,.md,.json,.yml,.yaml,.toml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.c,.cpp,.h,.cs,.rb,.php,.sh,.sql,.log,.csv,.xml,.diff,.patch" />
        </div>
      </div>

      {secrets.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2 text-[12.5px] text-fg">
          <ShieldAlert className="size-3.5 shrink-0 text-danger" aria-hidden />
          <span>
            This looks like it contains {secrets.join(", ")}. Anyone with the link can read a plain paste — consider turning on <strong>Encrypt</strong> and <strong>Burn after read</strong>, or remove the secret first.
          </span>
        </div>
      )}

      {/* Editor surface */}
      <div
        className={cn(
          "relative flex min-h-[60vh] flex-1 overflow-hidden bg-code-bg transition-colors",
          dragging && "ring-2 ring-inset ring-accent",
        )}
      >
        {image ? (
          <div className="flex flex-1 items-start justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL, unknown dimensions */}
            <img src={`data:${image};base64,${content}`} alt={title || "Image to paste"} className="max-h-[70vh] max-w-full rounded" />
          </div>
        ) : (
        <>
        <div ref={gutterRef} aria-hidden className="code select-none overflow-hidden border-r border-border bg-surface-2/60 py-3 text-right text-[var(--gutter)]">
          {gutter}
        </div>
        <textarea
          ref={textareaRef}
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Paste or type here… a lone link becomes a short link."
          aria-label="Paste content"
          className="editor-textarea min-h-[60vh] flex-1 resize-none bg-transparent px-4 py-3 outline-none placeholder:text-fg-faint"
        />
        </>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/70 text-[13px] text-fg-muted">
            Drop to load the file
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-x-3 overflow-hidden border-t border-border px-3 py-1.5 font-mono text-[11.5px] text-fg-faint">
        <span className={cn("truncate", tooLarge && "text-danger")}>
          {image
            ? `${LANGS.find((l) => l.id === lang)?.label} · ${formatBytes(base64Bytes(content))} of ${formatBytes(LIMITS.maxImageBytes)}`
            : `${lines} ${lines === 1 ? "line" : "lines"} · ${formatBytes(encrypt ? effectiveBytes : bytes)}`}
          {tooLarge ? ` · over the ${formatBytes(maxBytes)} limit` : encrypt ? " encrypted" : ""}
        </span>
        {tabHint && <span className="shrink-0">Tab now moves focus</span>}
        <noscript>
          <span>Encryption and burn-after-read need JavaScript.</span>
        </noscript>
        <span className={cn("ml-auto hidden shrink-0 truncate md:inline", shortens && "text-fg")}>
          {link
            ? shortens
              ? `looks like a link — save to get a short link that redirects to ${linkHost(link)}`
              : "encrypted and burn pastes don’t redirect; saved as text"
            : encrypt
              ? usePassword
                ? "the password never leaves your browser"
                : "the key lives in the link after #"
              : burn
                ? "destroyed after the first view"
                : "drop a file, an image, or a link to shorten"}
        </span>
      </div>
      </div>
    </form>
  );
}
