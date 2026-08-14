import express from 'express';

import { getHistory } from './cache.js';
import { config } from './config.js';
import { closeDb } from './db.js';
import {
  errorHandler,
  idempotency,
  logger,
  notFound,
  rateLimit,
  requestId,
  validateQuestion
} from './middleware.js';
import { Engine } from './pipeline.js';
import { PAGE } from './ui.js';

export function createApp(engine = new Engine(), { quiet = false } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(requestId);
  if (!quiet) app.use(logger);

  app.get('/', (req, res) => res.type('html').send(PAGE));
  app.post('/ask', rateLimit, validateQuestion, idempotency(engine));
  app.get('/history', (req, res) => res.json(getHistory()));
  app.get('/schema', (req, res) => res.type('text').send(engine.catalog.render(engine.catalog.tableNames)));
  app.get('/health', (req, res) =>
    res.json({ status: 'ok', provider: engine.client.name, model: engine.client.model })
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const engine = new Engine();
  const server = createApp(engine).listen(config.port, () => {
    process.stdout.write(`http://localhost:${config.port}  provider: ${engine.client.name}/${engine.client.model}\n`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => { closeDb(); process.exit(0); }));
  }
}
