import { Code2, Info, Lightbulb, Sparkles, Star } from 'lucide-react';

// Calm, readable callouts. Amber (not red) for pitfalls: red is reserved for real errors.
export const CALLOUTS = {
  important: { title: 'Important', Icon: Star, cls: 'callout-important' },
  mistake: { title: 'Common pitfall', Icon: Lightbulb, cls: 'callout-mistake' },
  tip: { title: 'Tip', Icon: Sparkles, cls: 'callout-tip' },
  example: { title: 'Example', Icon: Code2, cls: 'callout-example' },
  note: { title: 'Note', Icon: Info, cls: 'callout-note' },
};

export default function Callout({ type, children }) {
  const c = CALLOUTS[type] ?? CALLOUTS.note;
  return (
    <aside className={`callout ${c.cls}`} role="note" aria-label={c.title}>
      <div className="callout-title">
        <c.Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{c.title}</span>
      </div>
      <div className="callout-body">{children}</div>
    </aside>
  );
}
