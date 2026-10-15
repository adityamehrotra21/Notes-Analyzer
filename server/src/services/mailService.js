// Outgoing email. EMAIL_PROVIDER picks the transport:
//   brevo / resend : HTTPS APIs (no SMTP needed: Render's free plan blocks outbound SMTP ports)
//   smtp           : nodemailer (Gmail works with an App Password)
//   console        : write to the log instead of sending (dev; codes/links visible outside production)
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

const log = logger.child({ module: 'mail' });
let transport;

export const emailProvider = () => env.EMAIL_PROVIDER ?? (env.SMTP_HOST ? 'smtp' : 'console');

/** True when emails will actually be delivered (not just logged). */
export function mailConfigured() {
  switch (emailProvider()) {
    case 'brevo':
      return Boolean(env.BREVO_API_KEY && env.MAIL_FROM);
    case 'resend':
      return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
    case 'smtp':
      return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
    default:
      return false;
  }
}

/** "Name <a@b.c>" -> { name, email } */
function parseFrom(from) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from ?? '');
  return m ? { name: m[1]?.trim() || 'NotesAnalyser', email: m[2].trim() } : { name: 'NotesAnalyser', email: String(from ?? '').trim() };
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
}

const transports = {
  async brevo({ to, subject, html, text, attachments }) {
    // https://developers.brevo.com/reference/sendtransacemail
    await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': env.BREVO_API_KEY }, {
      sender: parseFrom(env.MAIL_FROM),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      ...(attachments.length ? { attachment: attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) } : {}),
    });
  },
  async resend({ to, subject, html, text, attachments }) {
    // https://resend.com/docs/api-reference/emails/send-email
    await postJson('https://api.resend.com/emails', { Authorization: `Bearer ${env.RESEND_API_KEY}` }, {
      from: env.MAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
    });
  },
  async smtp({ to, subject, html, text, attachments }) {
    await getTransport().sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject, html, text, attachments });
  },
};

function getTransport() {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Minimal, clean HTML email layout. `bodyHtml` must already be escaped/trusted. */
export function layout({ title, bodyHtml }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
      <tr><td style="padding:20px 24px;border-bottom:1px solid #e4e4e7;font-weight:600;font-size:15px">📘 NotesAnalyser</td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0 0 12px;font-size:18px">${esc(title)}</h1>
        <div style="font-size:14px;line-height:1.6;color:#3f3f46">${bodyHtml}</div>
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a">You received this because of activity on your NotesAnalyser account.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/**
 * @param {{ to, subject, html, text, attachments?: { filename, content: Buffer, contentType }[] }} mail
 * @returns {Promise<{ sent: boolean }>}
 */
export async function sendMail({ to, subject, html, text, attachments = [] }) {
  const meta = { to, subject, attachments: attachments.map((a) => `${a.filename} (${a.content.length} bytes)`) };
  const provider = emailProvider();
  if (!mailConfigured()) {
    log.warn(`email NOT sent (provider "${provider}" not configured; logged instead)`, { ...meta, text: env.NODE_ENV === 'production' ? undefined : text });
    return { sent: false };
  }
  const t0 = Date.now();
  try {
    await transports[provider]({ to, subject, html, text, attachments });
    log.info('email sent', { ...meta, provider, durationMs: Date.now() - t0 });
    return { sent: true };
  } catch (err) {
    log.error('email failed', { ...meta, provider, err });
    throw new AppError(502, "Couldn't send the email right now. Please try again later.");
  }
}

export { esc as escapeHtml };
