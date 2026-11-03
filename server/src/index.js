import { env } from './config/env.js';
import { connectDB, disconnectDB, failInterruptedDocuments } from './config/db.js';
import { createApp } from './app.js';
import { db } from './db/index.js';
import { appLogs } from './db/schema.js';
import logger from './utils/logger.js';
import budgetService from './services/budgetService.js';
import { startLogRetention } from './services/logRetention.js';
import { closePdfBrowser } from './services/exportService.js';

const log = logger.child({ module: 'server' });

async function main() {
  await connectDB();
  // Persist logs from here on (batched, async; console-only fallback if the DB write fails).
  logger.attachDbSink((entries) => db.insert(appLogs).values(entries));
  await failInterruptedDocuments();
  await budgetService.init();
  startLogRetention();

  const server = createApp().listen(env.PORT, () => {
    log.info(`Server listening on http://localhost:${env.PORT}`, {
      llmProvider: env.LLM_PROVIDER,
      embedProvider: env.EMBED_PROVIDER,
      mock: env.LLM_MOCK,
    });
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') log.error(`Port ${env.PORT} is already in use. Set a different PORT in server/.env.`);
    else log.error('server error', { err });
    process.exit(1);
  });

  const shutdown = (signal) => {
    log.info(`${signal} received, shutting down`);
    server.close(async () => {
      await closePdfBrowser();
      await logger.flush();
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(`Failed to start server: ${err.message}`, { err });
  process.exit(1);
});
