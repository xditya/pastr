import type { NextRequest } from "next/server";
import { LIMITS } from "@/lib/config";
import { errorResponse, json, options, prefersText, readBody, text, clientIp } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { createPaste } from "@/lib/service";
import { originFrom, pasteUrl } from "@/lib/url";

export const runtime = "nodejs";

export async function OPTIONS() {
  return options();
}

/**
 * Create a paste.
 *   JSON:      curl -H 'content-type: application/json' -d '{"content":"hi","lang":"go"}' /api/v1/pastes
 *   raw body:  curl --data-binary @main.go '/api/v1/pastes?name=main.go&expires=1d'
 *   form:      curl -F 'content=@main.go' -F expires=1h /api/v1/pastes
 * Terminal clients get the URL back as plain text; everyone else gets JSON.
 */
export async function POST(req: NextRequest) {
  const wantsText = prefersText(req);
  try {
    await enforceRateLimit("create", clientIp(req));
    const body = await readBody(req, LIMITS.maxBytes);
    const { paste, editToken } = await createPaste(body);
    const origin = originFrom(req);
    const url = pasteUrl(origin, paste.id, paste.lang);
    const rawUrl = `${origin}/${paste.id}/raw`;
    const headers = { Location: url, "X-Edit-Token": editToken };
    if (wantsText) return text(`${url}\n`, { status: 201, headers });
    return json({ ...paste, url, rawUrl, editToken }, { status: 201, headers });
  } catch (err) {
    return errorResponse(err, wantsText);
  }
}
