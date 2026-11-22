import { useState } from 'react';
import { emailError, suggestEmail } from '../utils/email.js';

/** Email field with inline validation. `showError` forces the message after a submit attempt. */
export default function EmailInput({ id = 'email', value, onChange, signup = false, showError = false }) {
  const [touched, setTouched] = useState(false);
  const error = touched || showError ? emailError(value, { signup }) : null;
  const suggestion = error ? suggestEmail(value) : null;
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="label">Email</label>
      <input
        id={id}
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {suggestion ? (
            <>
              Did you mean{' '}
              <button type="button" className="link font-medium" onClick={() => onChange(suggestion)}>
                {suggestion}
              </button>
              ?
            </>
          ) : (
            error
          )}
        </p>
      )}
    </div>
  );
}
