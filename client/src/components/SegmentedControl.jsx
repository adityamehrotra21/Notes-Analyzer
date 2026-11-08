import { onRovingKeyDown } from '../utils/roving.js';

/** Radiogroup of buttons. Options: { value, label, Icon?, iconOnly? }. Arrow keys move the selection. */
export default function SegmentedControl({ options, value, onChange, label, size = 'md' }) {
  const pad = size === 'sm' ? 'p-1.5' : 'px-3 py-1.5';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => onRovingKeyDown(e, options.map((o) => o.value), value, onChange)}
      className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-md text-sm font-medium ${pad} ${
              active
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {o.Icon && <o.Icon className="h-4 w-4" aria-hidden />}
            {!o.iconOnly && o.label}
          </button>
        );
      })}
    </div>
  );
}
