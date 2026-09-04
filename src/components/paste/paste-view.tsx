"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Eye, FileCode2, Flag, Flame, GitFork, Link2, Lock, Pencil, Share2, Trash2, WrapText } from "lucide-react";
import type { EncryptionMeta, PublicPaste } from "@/lib/paste";
import { api, ApiError } from "@/lib/client";
import { decryptEnvelope } from "@/lib/crypto";
import { highlightLinesClient } from "@/lib/highlight-client";
import { escapeHtml } from "@/lib/highlight-shared";
import { formatRelative } from "@/lib/expiry";
import { getLang, LANGS } from "@/lib/langs";
import { forgetPaste, getLocalPaste, rememberPaste, setPrefs, updateLocalPaste } from "@/lib/local";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useLocalPaste, useMounted, usePrefs } from "@/hooks/use-local";
import { useToast } from "@/components/ui/toast";
import { Button, IconButton, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { CodeBlock } from "./code-block";
import { MarkdownView } from "./markdown-view";
import { ShareDialog } from "./share-dialog";
import { Editor, type EditTarget, type SavedPaste } from "@/components/editor/editor";
import { copyToClipboard } from "@/lib/clipboard";
import { stashFork } from "@/components/editor/new-paste";
import { cn } from "@/lib/cn";

type Mode = "plain" | "encrypted" | "burn";

type Props = {
  mode: Mode;
  paste: PublicPaste;
  /** Server-highlighted lines for plain pastes; null when the client must highlight. */
  lines: string[] | null;
  origin: string;
  embed: boolean;
  sizeLabel: string;
};

type Revealed = { content: string; title?: string; lang: string; enc?: EncryptionMeta; secret?: { fragment: string } | { password: string } };

export function PasteView({ mode, paste, lines: ssrLines, origin, embed, sizeLabel }: Props) {
  const router = useRouter();
  const { push } = useToast();

  // What we actually display. Plain pastes start resolved; encrypted/burn resolve on the client.
  const [revealed, setRevealed] = useState<Revealed | null>(mode === "plain" ? { content: paste.content, title: paste.title, lang: paste.lang } : null);
  const [lines, setLines] = useState<string[] | null>(ssrLines);
  const [burned, setBurned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState("");
  const [autoFailed, setAutoFailed] = useState(false);
  const [pendingCipher, setPendingCipher] = useState<{ content: string; enc: EncryptionMeta } | null>(mode === "encrypted" && paste.enc ? { content: paste.content, enc: paste.enc } : null);

  const [preview, setPreview] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [share, setShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [report, setReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [tokenPrompt, setTokenPrompt] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenIntent, setTokenIntent] = useState<"edit" | "delete">("edit");

  const mounted = useMounted();
  const local = useLocalPaste(paste.id);
  const prefs = usePrefs();
  const wrap = prefs.wrap;
  const hasToken = !!local?.editToken;

  /** Key from the URL fragment (ignoring #L10 line anchors) or remembered locally. Client only. */
  const autoKey = useMemo(() => {
    if (!mounted) return undefined;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && !/^L\d+(?:-L?\d+)?$/.test(hash)) return hash;
    return local?.key;
  }, [mounted, local?.key]);

  /** Which secret the user must type, derived from state rather than stored. */
  const needsSecret: "fragment" | "password" | null =
    mounted && pendingCipher && !revealed && !busy
      ? pendingCipher.enc.kdf === "password"
        ? "password"
        : !autoKey || autoFailed
          ? "fragment"
          : null
      : null;

  // Client-side highlight whenever we hold plaintext the server didn't render.
  const highlight = useCallback(async (content: string, lang: string) => {
    const res = await highlightLinesClient(content, lang);
    setLines(res.lines);
  }, []);

  const decrypt = useCallback(
    async (cipher: { content: string; enc: EncryptionMeta }, secret: { fragment: string } | { password: string }) => {
      try {
        const env = await decryptEnvelope(cipher.content, cipher.enc, secret);
        setError(null);
        setRevealed({ content: env.content, title: env.title, lang: env.lang, enc: cipher.enc, secret });
        setLines(env.content.split("\n").map(escapeHtml));
        void highlight(env.content, env.lang);
        updateLocalPaste(paste.id, { title: env.title, lang: env.lang });
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not decrypt");
        setAutoFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [highlight, paste.id],
  );

  // Encrypted paste: try the link key automatically, once.
  const attempted = useRef(false);
  useEffect(() => {
    if (mode !== "encrypted" || !pendingCipher || revealed || attempted.current) return;
    if (pendingCipher.enc.kdf === "fragment" && autoKey) {
      attempted.current = true;
      // Kick off the async decrypt on the next tick; all state updates happen after the await.
      void Promise.resolve().then(() => decrypt(pendingCipher, { fragment: autoKey }));
    }
  }, [mode, pendingCipher, revealed, autoKey, decrypt]);

  const reveal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.read(paste.id);
      setBurned(true);
      forgetPaste(paste.id);
      if (p.enc) {
        setPendingCipher({ content: p.content, enc: p.enc });
        if (p.enc.kdf === "fragment" && autoKey) await decrypt({ content: p.content, enc: p.enc }, { fragment: autoKey });
      } else {
        setRevealed({ content: p.content, title: p.title, lang: p.lang });
        setLines(p.content.split("\n").map(escapeHtml));
        void highlight(p.content, p.lang);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "could not load the paste");
    } finally {
      setBusy(false);
    }
  }, [paste.id, autoKey, decrypt, highlight]);

  const submitSecret = async () => {
    if (!pendingCipher || !secretInput) return;
    setBusy(true);
    await decrypt(pendingCipher, pendingCipher.enc.kdf === "fragment" ? { fragment: secretInput.trim().replace(/^#/, "") } : { password: secretInput });
  };

  const copy = useCallback(async () => {
    if (!revealed) return;
    if (!(await copyToClipboard(revealed.content))) {
      push("error", "Copy failed — select the text and copy it manually");
      return;
    }
    setCopied(true);
    push("success", "Copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  }, [revealed, push]);

  const fork = useCallback(() => {
    if (!revealed) return;
    stashFork({ content: revealed.content, title: revealed.title, lang: revealed.lang });
    router.push("/");
  }, [revealed, router]);

  const toggleWrap = useCallback(() => setPrefs({ wrap: !wrap }), [wrap]);

  /** A rejected token is forgotten so the prompt can ask again. */
  const rejectToken = useCallback(
    (intent: "edit" | "delete") => {
      updateLocalPaste(paste.id, { editToken: undefined });
      setTokenIntent(intent);
      setEditing(false);
      setConfirmDelete(false);
      setTokenPrompt(true);
      push("error", "That edit token was rejected — enter it again");
    },
    [paste.id, push],
  );

  const startEdit = useCallback(() => {
    const token = getLocalPaste(paste.id)?.editToken;
    if (!token) {
      setTokenIntent("edit");
      setTokenPrompt(true);
      return;
    }
    setEditing(true);
  }, [paste.id]);

  const askDelete = useCallback(() => {
    if (getLocalPaste(paste.id)?.editToken) setConfirmDelete(true);
    else {
      setTokenIntent("delete");
      setTokenPrompt(true);
    }
  }, [paste.id]);

  const remove = async () => {
    const token = getLocalPaste(paste.id)?.editToken;
    if (!token) {
      setConfirmDelete(false);
      setTokenIntent("delete");
      setTokenPrompt(true);
      return;
    }
    setBusy(true);
    try {
      await api.delete(paste.id, token);
      forgetPaste(paste.id);
      push("success", "Paste deleted");
      router.push("/");
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return rejectToken("delete");
      push("error", e instanceof ApiError ? e.message : "could not delete");
    }
  };

  const sendReport = async () => {
    setBusy(true);
    try {
      const res = await api.report(paste.id, reportReason);
      push("success", res.message);
      setReport(false);
      setReportReason("");
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "could not send report");
    } finally {
      setBusy(false);
    }
  };

  const saveToken = () => {
    const t = tokenInput.trim();
    if (!t) return;
    if (getLocalPaste(paste.id)) updateLocalPaste(paste.id, { editToken: t });
    else
      rememberPaste({
        id: paste.id,
        title: revealed?.title,
        lang: revealed?.lang ?? paste.lang,
        created: paste.created,
        expires: paste.expires,
        burn: paste.burn,
        editToken: t,
        encrypted: !!paste.enc,
        key: revealed?.secret && "fragment" in revealed.secret ? revealed.secret.fragment : undefined,
      });
    setTokenPrompt(false);
    setTokenInput("");
    if (tokenIntent === "delete") setConfirmDelete(true);
    else setEditing(true);
  };

  useHotkeys(
    useMemo(
      () => [
        { combo: "c", handler: () => void copy() },
        { combo: "w", handler: toggleWrap },
        { combo: "e", handler: startEdit },
        { combo: "f", handler: fork },
        { combo: "n", handler: () => router.push("/") },
        ...(!paste.burn && !paste.enc ? [{ combo: "r", handler: () => window.open(`/${paste.id}/raw`, "_blank") }] : []),
      ],
      [copy, toggleWrap, startEdit, fork, router, paste.id, paste.burn, paste.enc],
    ),
  );

  const lang = revealed?.lang ?? paste.lang;
  const langLabel = getLang(lang)?.label ?? LANGS[0].label;
  const isMarkdown = lang === "markdown";
  const url = `${origin}/${paste.id}${!paste.enc && lang !== "text" ? `.${lang}` : ""}${revealed?.secret && "fragment" in revealed.secret ? `#${revealed.secret.fragment}` : ""}`;
  const rawUrl = `${origin}/${paste.id}/raw`;
  const title = revealed?.title ?? paste.title;

  /** Mobile: the system share sheet; elsewhere: our dialog with QR and embed. */
  const shareNative = useCallback(async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
    const data = { title: title || `${paste.id}`, url };
    if (nav.share && (!nav.canShare || nav.canShare(data)) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try {
        await nav.share(data);
        return;
      } catch {
        /* cancelled — fall through to the dialog */
      }
    }
    setShare(true);
  }, [title, paste.id, url]);

  // ---------- edit mode ----------
  if (editing && revealed) {
    const target: EditTarget = {
      id: paste.id,
      editToken: getLocalPaste(paste.id)?.editToken ?? "",
      content: revealed.content,
      title: revealed.title,
      lang: revealed.lang,
      enc: revealed.enc,
      secret: revealed.secret,
      expires: paste.expires,
      burn: paste.burn,
    };
    return (
      <Editor
        edit={target}
        onCancel={() => setEditing(false)}
        onAuthError={() => rejectToken("edit")}
        onSaved={(saved: SavedPaste) => {
          setEditing(false);
          if (revealed.enc) {
            // The server only holds fresh ciphertext; we already have the plaintext, so update in place.
            setRevealed({ content: saved.content, title: saved.title, lang: saved.lang, enc: saved.enc ?? revealed.enc, secret: revealed.secret });
            setLines(saved.content.split("\n").map(escapeHtml));
            void highlight(saved.content, saved.lang);
          } else {
            router.refresh();
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      {!embed && (
        <div className="flex flex-wrap items-start gap-3 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
              {paste.enc && <Lock className="size-4 shrink-0 text-fg-muted" aria-label="Encrypted" />}
              {paste.burn && <Flame className="size-4 shrink-0 text-warning" aria-label="Burn after read" />}
              <span className="truncate">{title || <span className="font-mono text-fg-muted">{paste.id}</span>}</span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
              <span className="flex items-center gap-1">
                <FileCode2 className="size-3" aria-hidden /> {paste.enc && !revealed ? "encrypted" : langLabel}
              </span>
              <time dateTime={new Date(paste.created).toISOString()} title={mounted ? new Date(paste.created).toLocaleString() : undefined} suppressHydrationWarning>
                {mounted ? formatRelative(paste.created) : isoMinute(paste.created)}
              </time>
              {paste.expires ? (
                <time dateTime={new Date(paste.expires).toISOString()} suppressHydrationWarning>
                  {mounted ? `expires ${formatRelative(paste.expires)}` : `expires ${isoMinute(paste.expires)}`}
                </time>
              ) : (
                <span>never expires</span>
              )}
              <span className="flex items-center gap-1">
                <Eye className="size-3" aria-hidden /> {paste.views.toLocaleString("en-US")} {paste.views === 1 ? "view" : "views"}
              </span>
              <span>{sizeLabel}</span>
              {paste.enc && <span>end-to-end encrypted</span>}
              {burned && <span className="text-warning">destroyed — this was the only view</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button onClick={copy} disabled={!revealed} title="Copy (c)" aria-label="Copy">
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              Copy
            </Button>
            {!paste.enc && !paste.burn && (
              <a href={`/${paste.id}/raw`} target="_blank" rel="noopener" className={buttonClass()} title="Raw (r)">
                <Link2 className="size-3.5" /> Raw
              </a>
            )}
            {!paste.enc && !paste.burn && (
              <a href={`/${paste.id}/raw?dl=1`} className={buttonClass()} title="Download" aria-label="Download">
                <Download className="size-3.5" /> <span className="sr-only sm:not-sr-only">Download</span>
              </a>
            )}
            {revealed && paste.enc && !paste.burn && (
              <Button onClick={() => downloadText(revealed.content, `${title || paste.id}.${getLang(revealed.lang)?.ext[0] ?? "txt"}`)} title="Download the decrypted text" aria-label="Download">
                <Download className="size-3.5" /> <span className="sr-only sm:not-sr-only">Download</span>
              </Button>
            )}
            {revealed && paste.burn && (
              <Button onClick={() => downloadText(revealed.content, `${title || paste.id}.${getLang(revealed.lang)?.ext[0] ?? "txt"}`)} title="Download a copy" aria-label="Download">
                <Download className="size-3.5" /> <span className="sr-only sm:not-sr-only">Download</span>
              </Button>
            )}
            {!burned && (
              <Button onClick={() => void shareNative()} title="Share" aria-label="Share">
                <Share2 className="size-3.5" /> <span className="sr-only sm:not-sr-only">Share</span>
              </Button>
            )}
            <Button onClick={fork} disabled={!revealed} title="Fork into a new paste (f)" aria-label="Fork">
              <GitFork className="size-3.5" /> <span className="sr-only sm:not-sr-only">Fork</span>
            </Button>
            {!paste.burn && (
              <Button onClick={startEdit} disabled={!revealed} title={hasToken ? "Edit (e)" : "Edit — needs the edit token"} aria-label="Edit">
                <Pencil className="size-3.5" /> <span className="sr-only sm:not-sr-only">Edit</span>
              </Button>
            )}
            {!burned && (
              <IconButton label="Delete" title={hasToken ? "Delete" : "Delete — needs the edit token"} variant="danger" onClick={askDelete}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
      )}

      {/* View toolbar */}
      {revealed && (
        <div className="mb-2 flex items-center gap-1.5">
          {isMarkdown && (
            <div role="group" aria-label="View" className="flex rounded-md border border-border p-0.5">
              <button type="button" aria-pressed={preview} onClick={() => setPreview(true)} className={cn("rounded px-2 py-0.5 text-[12px]", preview ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
                Preview
              </button>
              <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)} className={cn("rounded px-2 py-0.5 text-[12px]", !preview ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}>
                Source
              </button>
            </div>
          )}
          {(!isMarkdown || !preview) && (
            <button
              type="button"
              onClick={toggleWrap}
              aria-pressed={wrap}
              title="Toggle line wrap (w)"
              className={cn("flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px]", wrap ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg")}
            >
              <WrapText className="size-3.5" /> Wrap
            </button>
          )}
          <span className="ml-auto hidden text-[11px] text-fg-faint sm:flex sm:items-center sm:gap-1">
            {paste.enc ? "click a line number to select it" : "click a line number to link it"} · <Kbd>shift</Kbd> click for a range
          </span>
        </div>
      )}

      {/* Body */}
      {mode === "burn" && !revealed && !pendingCipher ? (
        <Gate
          icon={<Flame className="size-5 text-warning" />}
          title="This paste self-destructs after one view"
          body="Opening it will delete it from the server for everyone. Make sure you&apos;re ready to copy what you need."
          action={
            <Button variant="primary" onClick={reveal} loading={busy}>
              Reveal and destroy
            </Button>
          }
          error={error}
        />
      ) : needsSecret && !revealed ? (
        <Gate
          icon={<Lock className="size-5 text-fg-muted" />}
          title={needsSecret === "password" ? "This paste is protected with a password" : "This paste is encrypted"}
          body={
            (needsSecret === "password"
              ? "It was encrypted in the sender’s browser. Enter the password to decrypt it here — nothing is sent to the server."
              : "The decryption key is the part of the link after #. Paste the full link or just the key.") +
            (burned ? " This paste has already been removed from the server — don’t reload before decrypting." : "")
          }
          action={
            <form
              className="flex w-full max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void submitSecret();
              }}
            >
              <input
                type={needsSecret === "password" ? "password" : "text"}
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder={needsSecret === "password" ? "Password" : "Key"}
                aria-label={needsSecret === "password" ? "Password" : "Decryption key"}
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 text-[13px]"
              />
              <Button type="submit" variant="primary" loading={busy} disabled={!secretInput}>
                Decrypt
              </Button>
            </form>
          }
          error={error}
        />
      ) : !revealed ? (
        <div className="flex flex-1 items-center justify-center py-20 text-[13px] text-fg-muted">{busy ? "Decrypting…" : "Loading…"}</div>
      ) : isMarkdown && preview ? (
        <MarkdownView source={revealed.content} />
      ) : (
        <CodeBlock lines={lines ?? revealed.content.split("\n").map(escapeHtml)} wrap={wrap} linkable={!paste.enc} />
      )}

      {/* Footer row */}
      {!embed && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[12px] text-fg-faint">
          <span className="font-mono">{paste.id}</span>
          {revealed && <span>{revealed.content.split("\n").length.toLocaleString("en-US")} lines</span>}
          <span className="hidden sm:inline">
            <Kbd>c</Kbd> copy · <Kbd>e</Kbd> edit · <Kbd>f</Kbd> fork · <Kbd>w</Kbd> wrap · <Kbd>n</Kbd> new
          </span>
          {!burned && (
            <button type="button" onClick={() => setReport(true)} className="ml-auto flex items-center gap-1 hover:text-danger">
              <Flag className="size-3" /> Report
            </button>
          )}
        </div>
      )}
      {embed && (
        <div className="flex items-center justify-between py-1 text-[11px] text-fg-faint">
          <span className="font-mono">{paste.id}</span>
          <Link href={`/${paste.id}`} target="_blank" className="hover:text-fg">
            open ↗
          </Link>
        </div>
      )}

      {/* Dialogs */}
      <ShareDialog open={share} onClose={() => setShare(false)} url={url} rawUrl={paste.burn ? undefined : rawUrl} encrypted={!!paste.enc} />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this paste?">
        <p className="text-[13px] text-fg-muted">This removes it from the server immediately. Links to it will stop working.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="primary" className="bg-danger border-danger text-white" onClick={remove} loading={busy}>
            Delete
          </Button>
        </div>
      </Dialog>

      <Dialog open={tokenPrompt} onClose={() => setTokenPrompt(false)} title="Edit token needed">
        <p className="text-[13px] text-fg-muted">
          Editing and deleting need the edit token that was shown when the paste was created (it is remembered automatically in the browser that created it).
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveToken();
          }}
        >
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="Edit token" aria-label="Edit token" autoFocus className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 font-mono text-[12px]" />
          <Button type="submit" variant="primary" disabled={!tokenInput.trim()}>
            Continue
          </Button>
        </form>
      </Dialog>

      <Dialog open={report} onClose={() => setReport(false)} title="Report this paste">
        <p className="text-[13px] text-fg-muted">Tell us what&apos;s wrong (spam, malware, private data, illegal content). Reports are reviewed by the site operator.</p>
        <textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Reason"
          aria-label="Report reason"
          autoFocus
          className="mt-3 w-full rounded-md border border-border bg-bg px-2.5 py-2 text-[13px]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={() => setReport(false)}>Cancel</Button>
          <Button variant="primary" onClick={sendReport} loading={busy} disabled={reportReason.trim().length < 3}>
            Send report
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Deterministic timestamp for server rendering (no locale, no "ago" drift). */
function isoMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** Client-side download for content the server no longer has (burned) or cannot read (encrypted). */
function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^\w.\-]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Gate({ icon, title, body, action, error }: { icon: React.ReactNode; title: string; body: string; action: React.ReactNode; error: string | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-16 text-center">
      {icon}
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="max-w-md text-[13px] text-fg-muted">{body}</p>
      <div className="mt-2 flex w-full justify-center">{action}</div>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}
