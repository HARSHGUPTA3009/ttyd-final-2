import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { config } from '../src/config.js';

const URL =
  'https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sqlite';

mkdirSync(dirname(config.dbPath), { recursive: true });

if (existsSync(config.dbPath)) {
  process.stdout.write(`already there: ${config.dbPath}\n`);
} else {
  process.stdout.write(`downloading chinook -> ${config.dbPath}\n`);
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  writeFileSync(config.dbPath, Buffer.from(await response.arrayBuffer()));
}

const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
const customers = db.prepare('SELECT COUNT(*) AS n FROM Customer').get().n;
db.close();

process.stdout.write(`${tables.length} tables, ${customers} customers\n`);
if (tables.length < 11) {
  process.stderr.write('that does not look like Chinook\n');
  process.exit(1);
}
