import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { NewPaste } from "@/components/editor/new-paste";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <Shell wide>
      <NewPaste />
    </Shell>
  );
}
