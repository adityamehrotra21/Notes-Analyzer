import { api, authFetch } from './client.js';

/** Download an export (PDF / Markdown). Uses fetch so the file comes back as a blob. */
export async function downloadExport(spec) {
  const res = await authFetch('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...spec, email: false }),
  });
  if (!res.ok) {
    let message;
    try {
      message = (await res.json()).error?.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message || `Export failed (${res.status})`);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'export.pdf');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

/** Email the PDF to the signed-in user. Resolves { sent, to, filename }. */
export const emailExport = (spec) => api.post('/export', { ...spec, format: 'pdf', email: true }).then((r) => r.data);
