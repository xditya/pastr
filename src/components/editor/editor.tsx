"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Flame, Lock, Save, Upload } from "lucide-react";
import { DEFAULT_EXPIRY, EXPIRIES, LIMITS } from "@/lib/config";
import { byteLength, formatBytes } from "@/lib/bytes";
import { detectLang } from "@/lib/detect";
import { LANGS, langFromFilename } from "@/lib/langs";
import { encryptEnvelope, reencryptEnvelope } from "@/lib/crypto";
import type { EncryptionMeta } from "@/lib/paste";
import { api, ApiError } from "@/lib/client";
import { getPrefs, rememberPaste, setPrefs, updateLocalPaste } from "@/lib/local";
import { useHotkeys, isMac } from "@/hooks/use-hotkeys";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";
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

export type EditorProps = {
  /** When set, the editor updates an existing paste instead of creating a new one. */
  edit?: EditTarget;
  /** Pre-filled content (used by "Fork"). */
  initial?: { content: string; title?: string; lang?: string };
  onCancel?: () => void;
  onSaved?: (id: string) => void;
};

export function Editor({ edit, initial, onCancel, onSaved }: EditorProps) {
  const router = useRouter();
  const { push } = useToast();
  const prefs = useMemo(() => getPrefs(), []);

  const [content, setContent] = useState(edit?.content ?? initial?.content ?? "");
  const [title, setTitle] = useState(edit?.title ?? initial?.title ?? "");
  const [lang, setLang] = useState<string>(edit?.lang ?? initial?.lang ?? prefs.lang ?? "auto");
  const [expiry, setExpiry] = useState<string>(prefs.expiry ?? DEFAULT_EXPIRY);
  const [burn, setBurn] = useState(false);
  const [encrypt, setEncrypt] = useState(edit ? !!edit.enc : prefs.encryptByDefault);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(edit?.enc?.kdf === "password");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const bytes = useMemo(() => byteLength(content), [content]);
  const lines = useMemo(() => (content ? content.split("\n").length : 1), [content]);
  const detected = useMemo(() => (lang === "auto" ? detectLang(content) : lang), [lang, content]);
  const tooLarge = bytes > LIMITS.maxBytes;
  const canSave = content.trim().length > 0 && !tooLarge && !saving && (!encrypt || !usePassword || password.length > 0);

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  };

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > LIMITS.maxBytes) {
        push("error", `${file.name} is larger than ${formatBytes(LIMITS.maxBytes)}`);
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
    [push, title],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = "";
  };

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    // Tab indents by two spaces; Shift+Tab outdents. Escape then Tab still moves focus.
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end, value } = el;
    if (e.shiftKey) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      if (value.startsWith("  ", lineStart)) {
        const next = value.slice(0, lineStart) + value.slice(lineStart + 2);
        setContent(next);
        requestAnimationFrame(() => el.setSelectionRange(Math.max(lineStart, s - 2), Math.max(lineStart, end - 2)));
      }
      return;
    }
    const next = value.slice(0, s) + "  " + value.slice(end);
    setContent(next);
    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
  };

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const finalLang = lang === "auto" ? detectLang(content) : lang;
      const cleanTitle = title.trim() || undefined;
      setPrefs({ expiry, lang, encryptByDefault: encrypt });

      if (edit) {
        // ---- update existing paste ----
        if (edit.enc && edit.secret) {
          const { ciphertext, meta } = await reencryptEnvelope({ title: cleanTitle, lang: finalLang, content }, edit.enc, edit.secret);
          await api.update(edit.id, edit.editToken, { content: ciphertext, enc: meta });
        } else {
          await api.update(edit.id, edit.editToken, { content, title: cleanTitle ?? "", lang: finalLang });
        }
        updateLocalPaste(edit.id, { title: cleanTitle, lang: edit.enc ? "text" : finalLang });
        push("success", "Saved");
        onSaved?.(edit.id);
        return;
      }

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
      const target = `/${created.id}${!encrypt && finalLang !== "text" ? `.${finalLang}` : ""}${fragment ? `#${fragment}` : ""}`;
      onSaved?.(created.id);
      router.push(target);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "failed to save";
      push("error", msg);
      setSaving(false);
    }
  }, [canSave, lang, content, title, expiry, encrypt, edit, push, onSaved, usePassword, password, burn, router]);

  useHotkeys(
    useMemo(
      () => [
        { combo: "mod+s", handler: () => void save() },
        { combo: "mod+enter", handler: () => void save() },
        ...(onCancel ? [{ combo: "escape", handler: () => onCancel(), inInputs: true }] : []),
      ],
      [save, onCancel],
    ),
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  const mac = isMac();

  return (
    <form
      method="post"
      action="/api/v1/pastes"
      onSubmit={onSubmit}
      className="flex flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* Options bar */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          maxLength={LIMITS.maxTitle}
          aria-label="Title"
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-medium placeholder:text-fg-faint hover:border-border focus:border-border-strong focus:bg-surface"
        />
        <Select name="lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language" className="w-44">
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
            {LANGS.filter((l) => !POPULAR.includes(l.id)).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </optgroup>
        </Select>
        {!edit && (
          <Select name="expires" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry" className="w-44">
            {EXPIRIES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id === "never" ? "Never expires" : `Expires in ${e.label}`}
              </option>
            ))}
          </Select>
        )}
        {!edit && (
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg-muted hover:border-border-strong">
            <Flame className={cn("size-3.5", burn ? "text-warning" : "text-fg-faint")} aria-hidden />
            <span className="hidden sm:inline">Burn after read</span>
            <span className="sm:hidden">Burn</span>
            <Switch checked={burn} onChange={setBurn} label="Burn after read" />
            <input type="hidden" name="burn" value={burn ? "true" : "false"} />
          </label>
        )}
        <label
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-[13px] hover:border-border-strong",
            encrypt ? "border-border-strong bg-surface-2 text-fg" : "border-border bg-surface text-fg-muted",
            edit && "cursor-not-allowed opacity-60",
          )}
        >
          <Lock className={cn("size-3.5", encrypt ? "text-fg" : "text-fg-faint")} aria-hidden />
          <span className="hidden sm:inline">Encrypt</span>
          <Switch checked={encrypt} onChange={setEncrypt} label="Encrypt in browser" disabled={!!edit} />
        </label>
        {encrypt && !edit && (
          <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg-muted">
            <span className="hidden sm:inline">Password</span>
            <Switch checked={usePassword} onChange={setUsePassword} label="Protect with a password instead of a link key" />
            {usePassword && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="required"
                autoComplete="new-password"
                aria-label="Password"
                className="h-6 w-32 rounded border border-border bg-bg px-1.5 text-[13px]"
              />
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()} title="Open a text file">
            <Upload className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">File</span>
          </Button>
          <input ref={fileRef} type="file" className="hidden" onChange={onFileInput} accept="text/*,.md,.json,.yml,.yaml,.toml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.c,.cpp,.h,.cs,.rb,.php,.sh,.sql,.log,.csv,.xml,.diff,.patch" />
          <Button type="submit" variant="primary" disabled={!canSave} loading={saving}>
            <Save className="size-3.5" aria-hidden />
            {edit ? "Save changes" : "Save"}
            <Kbd className="ml-1 border-bg/30 bg-transparent text-bg/80">{mac ? "⌘" : "Ctrl"}S</Kbd>
          </Button>
        </div>
      </div>

      {/* Editor surface */}
      <div
        className={cn(
          "relative flex min-h-[60vh] flex-1 overflow-hidden rounded-lg border bg-code-bg transition-colors",
          dragging ? "border-accent" : "border-border",
        )}
      >
        <div ref={gutterRef} aria-hidden className="code select-none overflow-hidden border-r border-border bg-surface-2/60 py-3 text-right text-[var(--gutter)]">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="px-3">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleTab}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Paste or type here. Drop a file anywhere."
          aria-label="Paste content"
          className="editor-textarea min-h-[60vh] flex-1 resize-none bg-transparent px-4 py-3 outline-none placeholder:text-fg-faint"
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/70 text-[13px] text-fg-muted">
            Drop to load the file
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[12px] text-fg-faint">
        <span className={cn(tooLarge && "text-danger")}>
          {lines} {lines === 1 ? "line" : "lines"} · {content.length.toLocaleString()} chars · {formatBytes(bytes)}
          {tooLarge && ` — over the ${formatBytes(LIMITS.maxBytes)} limit`}
        </span>
        {encrypt && (
          <span className="flex items-center gap-1">
            <Lock className="size-3" aria-hidden />
            {usePassword ? "Encrypted with your password; the server never sees it." : "Encrypted in your browser; the key lives in the link after #."}
          </span>
        )}
        {burn && (
          <span className="flex items-center gap-1">
            <Flame className="size-3" aria-hidden /> Destroyed after the first view.
          </span>
        )}
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>Tab</Kbd> indents · <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>↵</Kbd> saves
        </span>
      </div>
    </form>
  );
}
