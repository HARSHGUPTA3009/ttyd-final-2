import express from 'express';

import { cacheKey, dropCached, getCached, getHistory, remember, setCached } from './cache.js';
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
import { Engine, toResponse } from './pipeline.js';
import { PAGE } from './ui.js';

export function createApp(engine = new Engine(), { quiet = false } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(requestId);
  if (!quiet) app.use(logger);

  app.get('/', (req, res) => res.type('html').send(PAGE));
  app.post('/ask', rateLimit, validateQuestion, idempotency(engine));
  app.get('/ask/stream', rateLimit, (req, res) => askStream(engine, req, res));
  app.get('/history', (req, res) => res.json(getHistory()));
  app.get('/schema', (req, res) => res.type('text').send(engine.catalog.render(engine.catalog.tableNames)));
  app.get('/health', (req, res) =>
    res.json({ status: 'ok', provider: engine.client.name, model: engine.client.model })
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

async function askStream(engine, req, res) {
  const question = String(req.query.q || '').trim();

  if (!question || question.length > config.maxQuestionLength) {
    return res.status(400).json({ error: 'invalid_question' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (event, payload) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  const key = cacheKey(question, engine.client.model);
  const hit = getCached(key);

  try {
    if (hit) {
      const cached = await hit.promise;
      send('stage', { stage: 'cache', status: 'ok', detail: 'served from cache', atMs: 0 });
      send('result', { ...toResponse(cached), cached: true });
      res.locals.outcome = cached.outcome;
      return res.end();
    }

    const entry = setCached(
      key,
      engine.ask(question, (step) => send('stage', step)).then((result) => {
        if (result.outcome === 'error') dropCached(key);
        else remember(result);
        return result;
      })
    );

    const result = await entry.promise;
    res.locals.outcome = result.outcome;
    send('result', toResponse(result));
    return res.end();
  } catch (error) {
    dropCached(key);
    send('stage', { stage: 'error', status: 'fail', detail: error.message, atMs: 0 });
    send('result', {
      question,
      outcome: 'error',
      answer: `Something went wrong: ${error.message}`,
      options: [],
      evidence: null,
      verification: 'n/a - the request failed'
    });
    return res.end();
  }
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
