import { api } from './client.js';

export const generationApi = {
  questions: (body) => api.post('/questions', body).then((r) => r.data),
  generateQuiz: (body) => api.post('/quiz/generate', body).then((r) => r.data),
  getQuiz: (id) => api.get(`/quiz/${id}`).then((r) => r.data.quiz),
  submitQuiz: (id, answers) => api.post(`/quiz/${id}/submit`, { answers }).then((r) => r.data),
  getAttempt: (attemptId) => api.get(`/quiz/attempts/${attemptId}`).then((r) => r.data),
  history: () => api.get('/quiz/history').then((r) => r.data),
};
