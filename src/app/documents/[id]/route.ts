import type { NextRequest } from "next/server";
import { clientIp, errorResponse, json, options } from "@/lib/http";
import { splitIdAndLang } from "@/lib/langs";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPaste } from "@/lib/service";

export const runtime = "nodejs";

export async function OPTIONS() {
  return options();
}

/** hastebin-compatible read: GET /documents/:key → {"data": "...", "key": "..."} */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = splitIdAndLang((await params).id);
    await enforceRateLimit("read", clientIp(req));
    const paste = await readPaste(id);
    return json({ data: paste.content, key: paste.id });
  } catch (err) {
    return errorResponse(err);
  }
}
