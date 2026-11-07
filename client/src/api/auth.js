import { api } from './client.js';

export const authApi = {
  register: (data) => api.post('/auth/register', data).then((r) => r.data),
  login: (data) => api.post('/auth/login', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  logout: () => api.post('/auth/logout'),
  logoutAll: () => api.post('/auth/logout-all').then((r) => r.data),
  sessions: () => api.get('/auth/sessions').then((r) => r.data.sessions),
  revokeSession: (id) => api.delete(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.post('/auth/sessions/revoke-others').then((r) => r.data),
  changePassword: (data) => api.post('/auth/change-password', data).then((r) => r.data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (data) => api.post('/auth/reset-password', data).then((r) => r.data),
};
