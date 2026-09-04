import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Expose-Headers": "Location, X-Edit-Token, X-Encrypted, X-Encryption-Meta, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining",
  "Access-Control-Max-Age": "86400",
};

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(data: T, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...NO_STORE, ...(init.headers ?? {}) },
  });
}

export function text(body: string, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new NextResponse(body, {
    ...init,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...CORS_HEADERS,
      ...NO_STORE,
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(err: unknown, wantsText = false) {
  const e =
    err instanceof HttpError
      ? err
      : new HttpError(500, "internal_error", "something went wrong");
  if (e.status >= 500) console.error(err);
  if (wantsText) return text(`error: ${e.message}\n`, { status: e.status, headers: e.headers });
  return json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: e.headers });
}

export function options() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Client IP for rate limiting.
 * On Vercel the platform rewrites X-Forwarded-For to the real client, so the first entry is trusted.
 * Elsewhere, TRUSTED_PROXY_HOPS (default 1) says how many proxies appended to the chain; we take the
 * entry that the outermost trusted proxy saw, so clients cannot spoof their way past the limiter.
 */
export function clientIp(req: Request): string {
  return ipFromHeaders(req.headers);
}

export function ipFromHeaders(h: Headers): string {
  const xff = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) {
    const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? (process.env.VERCEL ? 0 : 1));
    if (hops <= 0) return xff[0];
    return xff[Math.max(0, xff.length - hops)];
  }
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? "0.0.0.0";
}

/**
 * Decide between a bare-URL text response and JSON.
 * JSON in → JSON out. Otherwise terminal clients (curl, wget, httpie, …) get plain text
 * unless they explicitly ask for JSON; browsers and SDKs get JSON.
 */
export function prefersText(req: Request): boolean {
  const url = new URL(req.url);
  if (url.searchParams.has("plain")) return true;
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) return false;
  if (accept.includes("text/plain")) return true;
  if ((req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return false;
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  return /^(curl|wget|httpie|xh|fetch)\b/.test(ua) || ua.startsWith("python-requests");
}

export function bearerToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(/\s+/, 2);
  if (scheme?.toLowerCase() === "bearer" && token) return token.trim();
  return undefined;
}

/** Read the body with a hard byte cap, regardless of Content-Length (chunked uploads included). */
async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > maxBytes) throw new HttpError(413, "too_large", "request body too large");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "too_large", "request body too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Accepts JSON, HTML forms / multipart (curl -F), and raw text bodies so the
 * API is pleasant from a terminal: `curl --data-binary @file host/api/v1/pastes`.
 * `maxBytes` is the content cap; the wire cap allows for base64 ciphertext and form overhead.
 */
export async function readBody(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await readCapped(req, maxBytes * 2 + 64 * 1024);
  const text = () => new TextDecoder().decode(bytes);

  if (ct.includes("application/json")) {
    try {
      const parsed = JSON.parse(text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new HttpError(400, "bad_request", "JSON body must be an object");
      }
      return parsed as Record<string, unknown>;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "bad_request", "invalid JSON body");
    }
  }
  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": req.headers.get("content-type")! } }).formData();
    } catch {
      throw new HttpError(400, "bad_request", "invalid multipart body");
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") out[k] = v;
      else {
        out[k] = await v.text();
        if (v.name && !out.filename) out.filename = v.name;
      }
    }
    return out;
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    // curl's default content type for --data / --data-binary. If it doesn't look like a form
    // (no `content=` field) treat the whole body as the paste text, like hastebin does.
    const body = text();
    if (/(^|&)(content|data)=/.test(body)) {
      const params = new URLSearchParams(body);
      const out: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) out[k] = v;
      if (out.data !== undefined && out.content === undefined) out.content = out.data;
      return withQueryOptions(req, out);
    }
    return withQueryOptions(req, { content: body });
  }
  // Raw body (text/plain, application/octet-stream, …): the body is the content.
  return withQueryOptions(req, { content: text() });
}

/** Query-string options (?lang=go&expires=1d&name=main.go) complement form/raw bodies. */
function withQueryOptions(req: Request, out: Record<string, unknown>): Record<string, unknown> {
  const url = new URL(req.url);
  for (const key of ["title", "lang", "expires", "burn", "name", "filename"]) {
    const v = url.searchParams.get(key);
    if (v !== null && out[key === "name" ? "filename" : key] === undefined) out[key === "name" ? "filename" : key] = v;
  }
  return out;
}
