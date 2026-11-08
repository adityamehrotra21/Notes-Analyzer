/**
 * Arrow-key navigation for radiogroups / tablists (WAI-ARIA roving tabindex).
 * Call from the container's onKeyDown. Selects and focuses the next item.
 *
 * The current position comes from the focused element, not React state: selection changes can be
 * applied as a deferred transition (e.g. URL-driven tabs), and fast repeated key presses would
 * otherwise read a stale value.
 */
export function onRovingKeyDown(e, values, current, onChange) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
  const buttons = [...e.currentTarget.querySelectorAll('[role=radio], [role=tab]')];
  const focusedIdx = buttons.indexOf(document.activeElement);
  const i = focusedIdx >= 0 ? focusedIdx : values.indexOf(current);
  const nextIdx =
    e.key === 'Home' ? 0 : e.key === 'End' ? values.length - 1 : (i + keys[e.key] + values.length) % values.length;
  e.preventDefault();
  onChange(values[nextIdx]);
  buttons[nextIdx]?.focus();
}
