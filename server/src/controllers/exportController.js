import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { AppError } from '../utils/AppError.js';
import { renderExport } from '../services/exportService.js';
import { escapeHtml, layout, mailConfigured, sendMail } from '../services/mailService.js';
import auditService from '../services/auditService.js';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'export' });

/**
 * POST /api/export  { type, documentId?, documentIds?, refId?, options, format, email }
 * Download (PDF/Markdown) or email the PDF to the signed-in user. No LLM calls: existing content only.
 */
export async function createExport(req, res) {
  const { email, format, ...spec } = req.body;
  if (email && !mailConfigured()) {
    throw new AppError(503, "Email isn't set up on this server yet. Download the PDF instead.");
  }
  const file = await renderExport(req.user.id, spec, email ? 'pdf' : format);
  await auditService.record({
    action: 'create',
    entity: 'export',
    entityId: spec.refId ?? spec.documentId ?? spec.documentIds?.[0],
    after: { type: spec.type, format: email ? 'pdf' : format, emailed: email, filename: file.filename, bytes: file.buffer.length },
  });

  if (email) {
    const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, req.user.id));
    await sendMail({
      to: user.email,
      subject: `${file.title}${file.sourceName ? ` – ${file.sourceName}` : ''}`,
      text: `Hi ${user.name},\n\nYour export "${file.title}" is attached (${file.filename}).\n\nHappy studying!`,
      html: layout({
        title: file.title,
        bodyHtml: `<p>Hi ${escapeHtml(user.name)},</p><p>Your export <strong>${escapeHtml(file.title)}</strong>${file.sourceName ? ` for <em>${escapeHtml(file.sourceName)}</em>` : ''} is attached as a PDF.</p><p>Happy studying!</p>`,
      }),
      attachments: [{ filename: file.filename, content: file.buffer, contentType: file.contentType }],
    });
    log.info('export emailed', { type: spec.type, filename: file.filename });
    return res.json({ sent: true, to: user.email, filename: file.filename });
  }

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  res.setHeader('Content-Length', file.buffer.length);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(file.buffer);
}
