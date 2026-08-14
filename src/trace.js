import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { config } from './config.js';

export const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function digestRows(columns, rows) {
  return hash(JSON.stringify({ cols: [...columns].sort(), rows: rows.map((row) => JSON.stringify(row)).sort() }));
}

export function writeTrace(trace) {
  try {
    mkdirSync(dirname(config.tracePath), { recursive: true });
    appendFileSync(config.tracePath, `${JSON.stringify(trace)}\n`);
  } catch {
    return;
  }
}
