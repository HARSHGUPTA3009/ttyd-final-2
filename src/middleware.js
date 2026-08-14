import { randomUUID } from 'node:crypto';

import { cacheKey, dropCached, getCached, remember, setCached } from './cache.js';
import { config } from './config.js';
import { toResponse } from './pipeline.js';

export function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID();
  res.set('x-request-id', req.id);
  next();
}

export function logger(req, res, next) {
  const startedAt = performance.now();

  res.on('finish', () => {
    const parts = [
      new Date().toISOString(),
      req.method,
      req.originalUrl,
      res.statusCode,
      `${(performance.now() - startedAt).toFixed(1)}ms`
    ];
    if (res.locals.outcome) parts.push(`outcome=${res.locals.outcome}`);
    if (res.locals.cached) parts.push('cached');
    process.stdout.write(`${parts.join(' ')}\n`);
  });

  next();
}

const hits = new Map();

export function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip);

  if (!entry || now > entry.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + config.rateLimit.windowMs });
    return next();
  }

  entry.count += 1;
  if (entry.count > config.rateLimit.max) {
    res.set('retry-after', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'rate_limited', message: 'Too many questions, slow down.' });
  }

  return next();
}

export function validateQuestion(req, res, next) {
  const { question } = req.body || {};

  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'invalid_question', message: 'Send JSON with a non-empty "question".' });
  }

  if (question.length > config.maxQuestionLength) {
    return res.status(413).json({ error: 'question_too_long', message: `Limit is ${config.maxQuestionLength} characters.` });
  }

  req.question = question.trim();
  return next();
}

export function idempotency(engine) {
  return async (req, res, next) => {
    const key = req.get('idempotency-key') || cacheKey(req.question, engine.client.model);
    const existing = getCached(key);

    try {
      if (existing) {
        const cached = await existing.promise;
        res.locals.outcome = cached.outcome;
        res.locals.cached = true;
        return res.set('x-cache', 'hit').json({ ...toResponse(cached), cached: true });
      }

      const entry = setCached(
        key,
        engine.ask(req.question).then((result) => {
          if (result.outcome === 'error') dropCached(key);
          else remember(result);
          return result;
        })
      );

      const result = await entry.promise;
      res.locals.outcome = result.outcome;
      return res.set('x-cache', 'miss').json(toResponse(result));
    } catch (error) {
      dropCached(key);
      return next(error);
    }
  };
}

export function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  process.stderr.write(`${new Date().toISOString()} error id=${req.id} ${error.stack || error.message}\n`);
  return res.status(500).json({ error: 'internal_error', message: 'The request failed.', requestId: req.id });
}
