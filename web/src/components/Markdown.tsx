import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
};

/**
 * Renders assistant Markdown safely: raw HTML is skipped (never executed),
 * images are not loaded, and unsafe URLs (e.g. javascript:) are stripped by
 * react-markdown's default URL transform.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
