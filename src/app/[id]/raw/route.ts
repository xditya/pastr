import type { NextRequest } from "next/server";
import { clientIp, errorResponse, text } from "@/lib/http";
import { extensionFor, splitIdAndLang } from "@/lib/langs";
import { enforceRateLimit } from "@/lib/ratelimit";
import { readPaste } from "@/lib/service";

export const runtime = "nodejs";

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "paste";
}

/**
 * GET /:id/raw          → text/plain body (the ciphertext for encrypted pastes)
 * GET /:id/raw?dl=1     → download with a filename derived from the title/language
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: segment } = await params;
    const { id } = splitIdAndLang(segment);
    await enforceRateLimit("read", clientIp(req));
    const paste = await readPaste(id);
    const url = new URL(req.url);
    const download = url.searchParams.has("dl") || url.searchParams.has("download");
    const filename = paste.title
      ? safeFilename(paste.title.includes(".") ? paste.title : `${paste.title}.${extensionFor(paste.lang)}`)
      : `${paste.id}.${paste.enc ? "enc.txt" : extensionFor(paste.lang)}`;
    return text(paste.content, {
      headers: {
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        ...(paste.enc ? { "X-Encrypted": "1", "X-Encryption-Meta": JSON.stringify(paste.enc) } : {}),
      },
    });
  } catch (err) {
    return errorResponse(err, true);
  }
}
