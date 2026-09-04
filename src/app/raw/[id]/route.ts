import type { NextRequest } from "next/server";
import { clientIp, errorResponse, text } from "@/lib/http";
import { splitIdAndLang } from "@/lib/langs";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPaste } from "@/lib/service";

export const runtime = "nodejs";

/** hastebin-style alias: GET /raw/:key → text/plain */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = splitIdAndLang((await params).id);
    await enforceRateLimit("read", clientIp(req));
    const paste = await readPaste(id);
    return text(paste.content, { headers: { "X-Robots-Tag": "noindex" } });
  } catch (err) {
    return errorResponse(err, true);
  }
}
