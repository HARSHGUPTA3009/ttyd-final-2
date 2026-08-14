import { config } from './config.js';
import { hash } from './trace.js';

const entries = new Map();
const history = [];

export const cacheKey = (question, model) => hash(`${question.trim().toLowerCase()}|${model}`);

export function getCached(key) {
  const entry = entries.get(key);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry;
}

export function setCached(key, promise) {
  const entry = { promise, expiresAt: Date.now() + config.cacheTtlMs };
  entries.set(key, entry);

  if (entries.size > config.cacheMax) entries.delete(entries.keys().next().value);
  return entry;
}

export function dropCached(key) {
  entries.delete(key);
}

export function clearCache() {
  entries.clear();
  history.length = 0;
}

export function remember(result) {
  history.unshift({
    id: result.traceId,
    at: new Date().toISOString(),
    question: result.question,
    outcome: result.outcome,
    answer: result.answer,
    assumption: result.assumption,
    sql: result.evidence?.sql || '',
    rowCount: result.evidence?.rowCount ?? 0,
    columns: result.evidence?.columns || [],
    rows: (result.evidence?.rows || []).slice(0, 20),
    verification: result.verification
  });

  if (history.length > config.historyMax) history.pop();
}

export function getHistory() {
  return history;
}
