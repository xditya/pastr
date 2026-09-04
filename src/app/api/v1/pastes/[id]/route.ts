import type { NextRequest } from "next/server";
import { LIMITS } from "@/lib/config";
import { bearerToken, clientIp, errorResponse, json, options, readBody } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { deletePaste, readPaste, updatePaste } from "@/lib/service";
import { originFrom, pasteUrl } from "@/lib/url";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return options();
}

/** Read a paste. Counts a view; burn-after-read pastes are destroyed by this call. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await enforceRateLimit("read", clientIp(req));
    const paste = await readPaste(id);
    const origin = originFrom(req);
    return json({ ...paste, url: pasteUrl(origin, paste.id, paste.lang), rawUrl: `${origin}/${paste.id}/raw` });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Update content/title/lang. Requires `Authorization: Bearer <editToken>`. Keeps the original expiry. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await enforceRateLimit("mutate", clientIp(req));
    const body = await readBody(req, LIMITS.maxBytes);
    const paste = await updatePaste(id, bearerToken(req), body);
    return json(paste);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete. Requires `Authorization: Bearer <editToken>`. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await enforceRateLimit("mutate", clientIp(req));
    await deletePaste(id, bearerToken(req));
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return errorResponse(err);
  }
}
