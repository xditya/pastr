import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Sanitized GitHub-flavoured markdown. Raw HTML in the source is not rendered. */
export function MarkdownView({ source }: { source: string }) {
  return (
    <article className="prose mx-auto rounded-lg border border-border bg-surface px-6 py-6 max-sm:rounded-none max-sm:border-x-0 max-sm:px-4 sm:px-10 sm:py-8">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml>
        {source}
      </Markdown>
    </article>
  );
}
