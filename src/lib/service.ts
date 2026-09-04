import "server-only";
import { after } from "next/server";
import { LIMITS, allowedExpiries, env } from "./config";
import { byteLength } from "./bytes";
import { expiresAt, expirySeconds, normalizeExpiry } from "./expiry";
import { HttpError } from "./http";
import { isValidId, newId } from "./ids";
import { langFromFilename } from "./langs";
import { type PasteRecord, type PublicPaste, toPublic } from "./paste";
import { getStore } from "./store";
import { hashToken, newEditToken, safeEqual, verifyToken } from "./tokens";
import { createPasteSchema, firstIssue, reportSchema, updatePasteSchema } from "./validation";

export type CreatedPaste = { paste: PublicPaste; editToken: string };

/** Run best-effort work after the response is sent (kept alive on Vercel via `after`). */
function background(task: () => Promise<unknown>) {
  try {
    after(() => task().catch((err) => console.error("[background]", err)));
  } catch {
    // Outside a request scope (tests) — just run it.
    void task().catch((err) => console.error("[background]", err));
  }
}

export async function createPaste(raw: Record<string, unknown>): Promise<CreatedPaste> {
  // Filename hint (from multipart uploads or ?name=) fills in lang/title when absent.
  if (typeof raw.filename === "string") {
    const base = raw.filename.split(/[\\/]/).pop() ?? "";
    if (base && base !== "-") {
      const l = langFromFilename(base);
      if (l && (raw.lang === undefined || raw.lang === "" || raw.lang === "auto")) raw.lang = l.id;
      if (!raw.title) raw.title = base;
    }
  }
  if (raw.lang === "auto" || raw.lang === "") delete raw.lang;
  assertContentSize(raw.content);

  const parsed = createPasteSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const input = parsed.data;

  if (input.enc) {
    // Encrypted pastes carry title + lang inside the envelope; scrub anything the client sent in clear.
    input.title = undefined;
    input.lang = "text";
  }

  const expiry = normalizeExpiry(input.expires);
  if (!allowedExpiries().includes(expiry)) {
    throw new HttpError(400, "invalid", `expiry "${expiry}" is not allowed here (max ${process.env.MAX_EXPIRY})`);
  }
  const editToken = newEditToken();
  const now = Date.now();
  const store = getStore();

  let record: PasteRecord | undefined;
  for (let attempt = 0; attempt < 5 && !record; attempt++) {
    const candidate: PasteRecord = {
      v: 1,
      id: newId(),
      content: input.content,
      title: input.title,
      lang: input.lang,
      enc: input.enc,
      burn: input.burn,
      created: now,
      expires: expiresAt(expiry, now),
      editHash: await hashToken(editToken),
      size: byteLength(input.content),
    };
    if (await store.create(candidate, expirySeconds(expiry))) record = candidate;
  }
  if (!record) throw new HttpError(500, "id_collision", "could not allocate an id, try again");
  background(() => store.incrStat("created"));
  return { paste: toPublic(record, 0), editToken };
}

/** Oversized content is a 413, checked before schema validation so the code is stable. */
function assertContentSize(content: unknown): void {
  if (typeof content === "string" && byteLength(content) > LIMITS.maxBytes) {
    throw new HttpError(413, "too_large", `content exceeds ${LIMITS.maxBytes} bytes`);
  }
}

export function assertId(id: string): void {
  if (!isValidId(id)) throw new HttpError(404, "not_found", "paste not found");
}

/** Read for display: counts a view and burns burn-after-read pastes. */
export async function readPaste(id: string): Promise<PublicPaste> {
  assertId(id);
  const res = await getStore().read(id);
  if (!res) throw new HttpError(404, "not_found", "this paste doesn't exist, expired, or was burned");
  return toPublic(res.record, res.views);
}

export type PageView =
  | { mode: "plain" | "encrypted"; paste: PublicPaste }
  /** Burn-after-read pastes are never read during server rendering; the client reveals them. */
  | { mode: "burn"; paste: Omit<PublicPaste, "content"> & { content: "" } };

/** Page render: one peek, then one counting read unless the paste is burn-after-read. */
export async function viewPaste(id: string): Promise<PageView | null> {
  if (!isValidId(id)) return null;
  const store = getStore();
  const peek = await store.peek(id);
  if (!peek) return null;
  if (peek.record.burn) {
    const { content: _c, ...rest } = toPublic(peek.record, peek.views);
    void _c;
    return { mode: "burn", paste: { ...rest, content: "" } };
  }
  const res = await store.read(id);
  if (!res) return null;
  return { mode: res.record.enc ? "encrypted" : "plain", paste: toPublic(res.record, res.views) };
}

/** Read without side effects (metadata, previews, auth). */
export async function peekPaste(id: string): Promise<PublicPaste | null> {
  if (!isValidId(id)) return null;
  const res = await getStore().peek(id);
  return res ? toPublic(res.record, res.views) : null;
}

async function authorize(id: string, token: string | undefined): Promise<PasteRecord> {
  assertId(id);
  const res = await getStore().peek(id);
  if (!res) throw new HttpError(404, "not_found", "paste not found");
  if (!token) throw new HttpError(401, "unauthorized", "edit token required");
  const admin = env.adminToken;
  if (admin && safeEqual(token, admin)) return res.record;
  if (!(await verifyToken(token, res.record.editHash))) {
    throw new HttpError(403, "forbidden", "invalid edit token");
  }
  return res.record;
}

export async function updatePaste(id: string, token: string | undefined, raw: Record<string, unknown>): Promise<PublicPaste> {
  const record = await authorize(id, token);
  assertContentSize(raw.content);
  const parsed = updatePasteSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const input = parsed.data;

  const next: PasteRecord = { ...record };
  if (record.enc) {
    // Encrypted pastes: new ciphertext must come with fresh encryption metadata (never reuse an IV).
    if (input.content !== undefined) {
      if (!input.enc) throw new HttpError(400, "invalid", "encrypted pastes need a new `enc` alongside the ciphertext");
      if (input.enc.kdf !== record.enc.kdf) throw new HttpError(400, "invalid", "cannot change the key mode of an encrypted paste");
      if (input.enc.iv === record.enc.iv) throw new HttpError(400, "invalid", "enc.iv must be freshly generated");
      next.content = input.content;
      next.size = byteLength(input.content);
      next.enc = input.enc;
    } else if (input.enc) {
      throw new HttpError(400, "invalid", "`enc` can only change together with the content");
    }
    next.title = undefined;
    next.lang = "text";
  } else {
    if (input.enc) throw new HttpError(400, "invalid", "cannot encrypt an existing plain paste; create a new one");
    if (input.content !== undefined) {
      next.content = input.content;
      next.size = byteLength(input.content);
    }
    if (input.title !== undefined) next.title = input.title || undefined;
    if (input.lang !== undefined) next.lang = input.lang;
  }
  if (next.size > LIMITS.maxBytes) throw new HttpError(413, "too_large", "content too large");

  const ok = await getStore().update(next);
  if (!ok) throw new HttpError(404, "not_found", "paste not found");
  const views = (await getStore().peek(id))?.views ?? 0;
  return toPublic(next, views);
}

export async function deletePaste(id: string, token: string | undefined): Promise<void> {
  await authorize(id, token);
  await getStore().delete(id);
}

/**
 * Reporters are stored as a salted, truncated hash so repeat reports can be correlated without
 * keeping IPs. Without a secret to salt with, nothing about the reporter is stored at all.
 */
async function reporterId(ip: string): Promise<string> {
  const salt = process.env.REPORT_SALT || env.adminToken || env.redisToken;
  if (!salt) return "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|reporter|${ip}`));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function reportPaste(id: string, raw: Record<string, unknown>, ip: string): Promise<{ ok: true; count: number }> {
  assertId(id);
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const exists = await getStore().peek(id);
  if (!exists) throw new HttpError(404, "not_found", "paste not found");
  const reason = parsed.data.reason;
  const count = await getStore().report(id, reason, await reporterId(ip));
  const webhook = env.reportWebhookUrl;
  if (webhook) {
    // Discord-compatible payload (mentions disabled, reason fenced); other webhooks get the same JSON.
    const fenced = "```\n" + reason.replace(/```/g, "'''") + "\n```";
    background(async () => {
      const res = await fetch(webhook, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `Paste reported: ${id} (report #${count})\n${fenced}`,
          allowed_mentions: { parse: [] },
          paste: id,
          reason,
          count,
        }),
      });
      if (!res.ok) console.error(`[report] webhook responded ${res.status}`);
    });
  }
  return { ok: true, count };
}
