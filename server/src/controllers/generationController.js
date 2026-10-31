import { getPracticeQuestions } from '../services/questionService.js';
import { generateQuiz, getQuiz, submitQuiz, getAttempt, getHistory } from '../services/quizService.js';

export async function questions(req, res) {
  res.json(await getPracticeQuestions({ userId: req.user.id, ...req.body }));
}

export async function quizGenerate(req, res) {
  const result = await generateQuiz({ userId: req.user.id, ...req.body });
  res.status(result.cached ? 200 : 201).json(result);
}

export async function quizGet(req, res) {
  res.json({ quiz: await getQuiz({ userId: req.user.id, quizId: req.valid.params.id }) });
}

export async function quizSubmit(req, res) {
  res.status(201).json(await submitQuiz({ userId: req.user.id, quizId: req.valid.params.id, answers: req.body.answers }));
}

export async function quizAttempt(req, res) {
  res.json(await getAttempt({ userId: req.user.id, attemptId: req.valid.params.attemptId }));
}

export async function quizHistory(req, res) {
  res.json(await getHistory({ userId: req.user.id }));
}
