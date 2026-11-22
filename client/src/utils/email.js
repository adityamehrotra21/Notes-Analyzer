// Instant feedback only; the server repeats these checks and also verifies the domain at signup.
const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

const TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.in': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
  'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'icoud.com': 'icloud.com',
};

export const cleanEmail = (v) => v.trim().toLowerCase();

export function isValidEmail(value) {
  const v = cleanEmail(value);
  return v.length <= 254 && v.indexOf('@') <= 64 && EMAIL.test(v);
}

export function suggestEmail(value) {
  const [local, domain] = cleanEmail(value).split('@');
  return local && TYPOS[domain] ? `${local}@${TYPOS[domain]}` : null;
}

/** Message for a form, or null if the address can be submitted. */
export function emailError(value, { signup = false } = {}) {
  if (!value.trim()) return 'Enter your email';
  if (!isValidEmail(value)) return 'Enter a valid email address, like name@example.com';
  if (signup && suggestEmail(value)) return `Did you mean ${suggestEmail(value)}?`;
  return null;
}
