// Email checks: format (login, signup, reset) and, for new accounts only, typos + a real mail domain.
import { Resolver } from 'node:dns/promises';
import { env } from '../config/env.js';

const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

const TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.in': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
  'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'icoud.com': 'icloud.com',
};

export function isValidEmailFormat(email) {
  if (typeof email !== 'string' || email.length > 254) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  return local.length <= 64 && LOCAL.test(local) && labels.length >= 2 && labels.every((l) => LABEL.test(l)) && TLD.test(labels.at(-1));
}

/** "a@gmial.com" -> "a@gmail.com", or null when the domain isn't a known typo. */
export function suggestEmail(email) {
  const [local, domain] = email.split('@');
  return TYPOS[domain] ? `${local}@${TYPOS[domain]}` : null;
}

const DEAD = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Can this domain receive mail? MX records, or an A/AAAA record (the SMTP fallback).
 * A DNS outage or timeout returns true: our DNS being down must never block a signup.
 */
export async function domainAcceptsMail(domain, resolver = new Resolver({ timeout: 2500, tries: 1 })) {
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length) return mx.some((r) => r.exchange && r.exchange !== '.'); // "." is a null MX: "no mail here"
  } catch (err) {
    if (!DEAD.has(err.code)) return true;
    if (err.code === 'ENOTFOUND') return false;
  }
  for (const lookup of ['resolve4', 'resolve6']) {
    try {
      if ((await resolver[lookup](domain)).length) return true;
    } catch (err) {
      if (!DEAD.has(err.code)) return true;
    }
  }
  return false;
}

/** Signup check. @returns an error message, or null when the address looks deliverable. */
export async function newAccountEmailProblem(email, resolver) {
  const suggestion = suggestEmail(email);
  if (suggestion) return `Did you mean ${suggestion}?`;
  if (!env.EMAIL_DNS_CHECK) return null;
  const ok = await domainAcceptsMail(email.split('@')[1], resolver);
  return ok ? null : `${email.split('@')[1]} can't receive email. Check the address.`;
}
