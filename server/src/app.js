import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pingDB } from './config/db.js';
import { env } from './config/env.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import chatRoutes from './routes/chat.js';
import summarizeRoutes from './routes/summarize.js';
import { questionsRouter, quizRouter } from './routes/generation.js';
import { adminRouter, budgetRouter } from './routes/admin.js';
import exportRoutes from './routes/export.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';

export function createApp() {
  const app = express();
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(helmet());
  // CLIENT_ORIGIN may list several origins (comma-separated). credentials: the refresh cookie.
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await pingDB();
      res.json({ ok: true, db: 'connected' });
    } catch {
      res.status(503).json({ ok: false, db: 'disconnected' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/summarize', summarizeRoutes);
  app.use('/api/questions', questionsRouter);
  app.use('/api/quiz', quizRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/budget', budgetRouter);
  app.use('/api/export', exportRoutes);

  // SERVE_CLIENT=true: also serve the built React app (npm run build) from this origin — for a single-
  // container local run. In the Vercel + Render setup the client is hosted on Vercel and this stays off.
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (env.SERVE_CLIENT && existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders(res, path) {
          // Hashed assets never change; index.html must always be revalidated.
          res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    // SPA fallback: any non-API GET returns index.html and React Router takes over.
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: clientDist });
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
