import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  dbPath: process.env.TTYD_DB || join(ROOT, 'data', 'chinook.db'),
  catalogPath: join(ROOT, 'src', 'catalog.yaml'),
  tracePath: join(ROOT, 'traces', 'traces.jsonl'),

  maxRows: 1000,
  maxTables: 8,
  maxRepairAttempts: 1,
  numericTolerance: 1e-4,

  model: process.env.TTYD_MODEL || 'llama-3.3-70b-versatile',
  temperature: 0,
  maxTokens: 1500,
  llmTimeoutMs: 60000,

  port: Number(process.env.PORT || 8000),
  maxQuestionLength: 2000,
  rateLimit: { windowMs: 60000, max: 60 },

  cacheTtlMs: Number(process.env.TTYD_CACHE_TTL_MS || 300000),
  cacheMax: 200,
  historyMax: 25
};
