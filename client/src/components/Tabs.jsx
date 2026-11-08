import { onRovingKeyDown } from '../utils/roving.js';

export const tabId = (id) => `tab-${id}`;
export const TAB_PANEL_ID = 'tabpanel';

/** Accessible tablist: arrow keys / Home / End move between tabs. */
export default function Tabs({ tabs, active, onChange, label }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => onRovingKeyDown(e, tabs.map((t) => t.id), active, onChange)}
      className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
    >
      {tabs.map(({ id, label: text, Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            id={tabId(id)}
            role="tab"
            aria-selected={selected}
            aria-controls={TAB_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${
              selected
                ? 'border-indigo-600 text-zinc-900 dark:border-indigo-400 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {text}
          </button>
        );
      })}
    </div>
  );
}
