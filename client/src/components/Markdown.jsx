import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { InlineCitation } from './chat/CitationChip.jsx';
import Callout from './Callout.jsx';
import remarkCallouts from '../utils/remarkCallouts.js';

// [S1] markers become links that render as citation badges.
const linkCitations = (text) => text.replace(/\[S(\d+)\]/g, '[S$1](#cite-S$1)');

const rehypePlugins = [[rehypeHighlight, { detect: false }]];

/** Plain text of rendered React children (to classify callouts / labels). */
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

/** Fenced code block with language label and copy button. */
function CodeBlock({ children, ...props }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const className = children?.props?.className ?? '';
  const lang = /language-([\w+-]+)/.exec(className)?.[1];
  return (
    <div className="code-block group relative">
      <div className="flex items-center justify-between rounded-t-lg border-b border-zinc-200 bg-zinc-200/60 px-3 py-1 text-[0.7rem] dark:border-zinc-700 dark:bg-zinc-900/80">
        <span className="font-mono text-zinc-600 dark:text-zinc-400">{lang ?? 'code'}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(ref.current?.innerText ?? '');
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={ref} {...props} className="!mt-0 !rounded-t-none">
        {children}
      </pre>
    </div>
  );
}

/**
 * Markdown with GFM tables/lists, syntax-highlighted code blocks and optional citation badges.
 * - `sources`: turns [S#] markers into citation badges
 * - `inline`: render without block paragraphs (for quiz options, question stems in headings, etc.)
 */
export default function MarkdownView({ children, sources, className = '', inline = false }) {
  const byTag = new Map((sources ?? []).map((s) => [s.tag, s]));
  const text = sources ? linkCitations(children ?? '') : (children ?? '');
  const components = {
    a({ href, children: label }) {
      if (sources && href?.startsWith('#cite-')) {
        const tag = href.slice('#cite-'.length);
        return <InlineCitation tag={tag} source={byTag.get(tag)} />;
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="link">
          {label}
        </a>
      );
    },
    pre: CodeBlock,
    // "> [!MISTAKE] …" etc. (and older "> ⚠️ …" / "> ⭐ …") arrive tagged by remarkCallouts.
    blockquote({ node, children: c }) {
      const type = node?.properties?.dataCallout;
      return type ? <Callout type={type}>{c}</Callout> : <blockquote>{c}</blockquote>;
    },
    // "**Example (added):**" (not from the notes) vs "**Example (from notes, p. N):**".
    strong({ children: c }) {
      const t = textOf(c);
      if (/^Example \(added\)/i.test(t)) return <span className="example-badge example-added" title="This example was written by the AI, not taken from your notes">{c}</span>;
      if (/^Example \(from notes/i.test(t)) return <span className="example-badge example-notes">{c}</span>;
      return <strong>{c}</strong>;
    },
    table: ({ children: c }) => (
      <div className="overflow-x-auto">
        <table>{c}</table>
      </div>
    ),
    ...(inline ? { p: ({ children: c }) => <>{c}</> } : {}),
  };
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={`${inline ? 'prose-inline' : 'prose-chat'} ${className}`}>
      <Markdown remarkPlugins={[remarkGfm, remarkCallouts]} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </Markdown>
    </Wrapper>
  );
}
