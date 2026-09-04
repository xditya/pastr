import "server-only";
import { LIMITS } from "./config";
import { byteLength } from "./bytes";
import { expiresAt, expirySeconds, normalizeExpiry } from "./expiry";
import { HttpError } from "./http";
import { isValidId, newId } from "./ids";
import { langFromFilename } from "./langs";
import { type PasteRecord, type PublicPaste, toPublic } from "./paste";
import { getStore } from "./store";
import { hashToken, newEditToken, safeEqual, verifyToken } from "./tokens";
import { createPasteSchema, firstIssue, reportSchema, updatePasteSchema } from "./validation";
import { env } from "./config";

export type CreatedPaste = { paste: PublicPaste; editToken: string };

export async function createPaste(raw: Record<string, unknown>): Promise<CreatedPaste> {
  // Filename hint (from multipart uploads or ?name=) fills in lang/title when absent.
  if (typeof raw.filename === "string" && raw.filename) {
    const l = langFromFilename(raw.filename);
    if (l && (raw.lang === undefined || raw.lang === "" || raw.lang === "auto")) raw.lang = l.id;
    if (!raw.title) raw.title = raw.filename;
  }
  if (raw.lang === "auto" || raw.lang === "") delete raw.lang;

  const parsed = createPasteSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const input = parsed.data;

  if (input.enc) {
    // Encrypted pastes carry title + lang inside the envelope; scrub anything the client sent in clear.
    input.title = undefined;
    input.lang = "text";
  }

  const expiry = normalizeExpiry(input.expires);
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
  void store.incrStat("created").catch(() => {});
  return { paste: toPublic(record, 0), editToken };
}

export function assertId(id: string): void {
  if (!isValidId(id)) throw new HttpError(404, "not_found", "paste not found");
}

/** Read for display: counts a view and burns burn-after-read pastes. */
export async function readPaste(id: string): Promise<PublicPaste> {
  assertId(id);
  const res = await getStore().read(id);
  if (!res) throw new HttpError(404, "not_found", "this paste doesn't exist, expired, or was burned");
  void getStore().incrStat("views").catch(() => {});
  return toPublic(res.record, res.views);
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
  const parsed = updatePasteSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const input = parsed.data;

  const next: PasteRecord = { ...record };
  if (input.content !== undefined) {
    next.content = input.content;
    next.size = byteLength(input.content);
  }
  if (record.enc || input.enc) {
    // Encrypted pastes: only the ciphertext + iv may change; metadata stays scrubbed.
    if (input.enc) next.enc = input.enc;
    next.title = undefined;
    next.lang = "text";
  } else {
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

export async function reportPaste(id: string, raw: Record<string, unknown>, ip: string): Promise<{ ok: true; count: number }> {
  assertId(id);
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid", firstIssue(parsed.error));
  const exists = await getStore().peek(id);
  if (!exists) throw new HttpError(404, "not_found", "paste not found");
  const count = await getStore().report(id, parsed.data.reason, ip);
  const webhook = env.reportWebhookUrl;
  if (webhook) {
    // Discord-compatible payload; other webhooks get the same JSON.
    void fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Paste reported: ${id} (report #${count})\nReason: ${parsed.data.reason}`,
        paste: id,
        reason: parsed.data.reason,
        count,
      }),
    }).catch((err) => console.error("[report] webhook failed", err));
  }
  return { ok: true, count };
}
