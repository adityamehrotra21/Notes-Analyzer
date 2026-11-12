import { api } from './client.js';

export const MAX_FILE_MB = 20;
export const MAX_FILES = 10;

export const documentsApi = {
  list: () => api.get('/documents').then((r) => r.data.documents),
  get: (id) => api.get(`/documents/${id}`).then((r) => r.data.document),
  remove: (id) => api.delete(`/documents/${id}`),
  reindexEstimate: (id) => api.get(`/documents/${id}/reindex/estimate`).then((r) => r.data),
  reindex: (id) => api.post(`/documents/${id}/reindex`).then((r) => r.data),
  upload: (files, onProgress) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return api
      .post('/documents/upload', form, {
        onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
      })
      .then((r) => r.data.documents);
  },
};
