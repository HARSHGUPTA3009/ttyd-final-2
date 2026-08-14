import Database from 'better-sqlite3';

import { config } from './config.js';

export class ExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutionError';
    this.stage = 'execute';
  }
}

let db = null;

function connection() {
  if (!db) {
    db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = 1');
    db.pragma('trusted_schema = OFF');
  }
  return db;
}

export function execute(sql, maxRows = config.maxRows) {
  const startedAt = performance.now();
  let statement;

  try {
    statement = connection().prepare(sql);
  } catch (error) {
    throw new ExecutionError(error.message);
  }

  if (!statement.reader) throw new ExecutionError('only read queries are permitted');

  const rows = [];
  let truncated = false;

  try {
    for (const row of statement.raw(true).iterate()) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
  } catch (error) {
    throw new ExecutionError(error.message);
  }

  return {
    columns: statement.columns().map((column) => column.name),
    rows,
    rowCount: rows.length,
    truncated,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    numbers: () => rows.flat().filter((cell) => typeof cell === 'number' && Number.isFinite(cell))
  };
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
