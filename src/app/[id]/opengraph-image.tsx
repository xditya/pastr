import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config";
import { getLang, imageMime, splitIdAndLang } from "@/lib/langs";
import { getPeek } from "@/lib/view";
import { headers } from "next/headers";
import { enforceRateLimit } from "@/lib/ratelimit";
import { HttpError, ipFromHeaders } from "@/lib/http";

export const alt = "Paste preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = splitIdAndLang((await params).id);
  try {
    await enforceRateLimit("read", ipFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status, headers: err.headers });
    throw err;
  }
  const paste = await getPeek(id);
  const hidden = !paste || !!paste.enc || paste.burn;
  const title = !paste ? "Paste not found" : paste.enc ? "Encrypted paste" : paste.burn ? "Burn-after-read paste" : (paste.title ?? `Paste ${id}`);
  const langLabel = paste && !hidden ? (getLang(paste.lang)?.label ?? "Plain text") : "";
  const preview = paste && !hidden && !imageMime(paste.lang) ? paste.content.split("\n").slice(0, 11) : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0a",
          color: "#ededed",
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: "#a3a3a3" }}>
          <div style={{ width: 22, height: 28, border: "3px solid #a3a3a3", borderRadius: 6 }} />
          <span>{SITE.name}</span>
          {langLabel && <span style={{ marginLeft: "auto", fontSize: 22 }}>{langLabel}</span>}
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600, marginTop: 28, letterSpacing: -1 }}>{title.slice(0, 60)}</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 28,
            flex: 1,
            background: "#111111",
            border: "2px solid #262626",
            borderRadius: 16,
            padding: 28,
            fontFamily: "monospace",
            fontSize: 22,
            lineHeight: 1.5,
            color: "#d4d4d4",
            overflow: "hidden",
          }}
        >
          {hidden ? (
            <div style={{ color: "#737373" }}>{paste?.enc ? "Content is end-to-end encrypted." : paste?.burn ? "Content is revealed once, then destroyed." : ""}</div>
          ) : (
            preview.map((line, i) => (
              <div key={i} style={{ display: "flex", whiteSpace: "pre" }}>
                <span style={{ width: 48, color: "#525252" }}>{i + 1}</span>
                <span>{line.slice(0, 90)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
