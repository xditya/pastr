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

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
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

/**
 * Accepts JSON, HTML forms / multipart (curl -F), and raw text bodies so the
 * API is pleasant from a terminal: `curl --data-binary @file host/api/v1/pastes`.
 */
export async function readBody(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length && length > maxBytes * 2) throw new HttpError(413, "too_large", "request body too large");

  if (ct.includes("application/json")) {
    try {
      const parsed = (await req.json()) as unknown;
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
    const form = await req.formData();
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
    const body = await req.text();
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
  return withQueryOptions(req, { content: await req.text() });
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
