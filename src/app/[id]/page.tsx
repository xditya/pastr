import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { SITE } from "@/lib/config";
import { getLang, splitIdAndLang } from "@/lib/langs";
import { highlightLines } from "@/lib/highlight";
import { getView } from "@/lib/view";
import { formatBytes } from "@/lib/bytes";
import { Shell } from "@/components/shell";
import { PasteView } from "@/components/paste/paste-view";

export const dynamic = "force-dynamic";

/** Cheap content fingerprint (FNV-1a) for the remount key; not security-relevant. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

type Props = PageProps<"/[id]">;

async function resolve(props: Props) {
  const { id: segment } = await props.params;
  const { id, lang: suffix } = splitIdAndLang(segment);
  const view = await getView(id);
  if (!view) notFound();
  const override = suffix ? getLang(suffix)?.id : undefined;
  return { id, view, override };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id, view } = await resolve(props);
  const { paste } = view;
  const title = paste.title ?? (view.mode === "encrypted" ? "Encrypted paste" : view.mode === "burn" ? "Burn-after-read paste" : `Paste ${id}`);
  const description =
    view.mode === "plain"
      ? paste.content.split("\n").slice(0, 3).join(" ").slice(0, 160) || SITE.description
      : view.mode === "burn"
        ? "This paste self-destructs after it is viewed once."
        : "This paste is end-to-end encrypted. Only someone with the key can read it.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "article", url: `/${id}` },
    twitter: { card: "summary_large_image", title, description },
    alternates: { canonical: `/${id}` },
  };
}

export default async function PastePage(props: Props) {
  const { view, override } = await resolve(props);
  const search = await props.searchParams;
  const embed = search.embed === "1" || search.embed === "true";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || `${proto}://${host}`;

  const lang = override ?? view.paste.lang;
  const highlighted = view.mode === "plain" ? await highlightLines(view.paste.content, lang) : null;

  // Remount the client view whenever the stored paste changes (e.g. after an edit + router.refresh()).
  const versionKey = `${view.paste.id}:${view.paste.size}:${view.paste.lang}:${view.paste.title ?? ""}:${fnv1a(view.paste.content)}`;

  const content = (
    <PasteView
      key={versionKey}
      mode={view.mode}
      paste={{ ...view.paste, lang }}
      lines={highlighted?.lines ?? null}
      origin={origin}
      embed={embed}
      sizeLabel={formatBytes(view.paste.size)}
    />
  );

  if (embed) return <div className="p-2">{content}</div>;
  return <Shell wide>{content}</Shell>;
}
