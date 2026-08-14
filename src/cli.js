import { createInterface } from 'node:readline/promises';

import { closeDb } from './db.js';
import { Engine, toResponse } from './pipeline.js';

const COLOR = { answer: '[32m', clarify: '[33m', refuse: '[36m', error: '[31m' };
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

function table(columns, rows) {
  const widths = columns.map((column, i) =>
    Math.max(String(column).length, ...rows.map((row) => String(row[i] ?? 'NULL').length))
  );
  const lines = [`${DIM}${columns.map((c, i) => String(c).padEnd(widths[i])).join('  ')}${RESET}`];
  for (const row of rows) lines.push(row.map((cell, i) => String(cell ?? 'NULL').padEnd(widths[i])).join('  '));
  return lines.join('\n');
}

function show(result) {
  const color = COLOR[result.outcome] || RESET;
  process.stdout.write(`\n${color}${BOLD}${result.outcome.toUpperCase()}${RESET}\n${result.answer}\n`);

  if (result.assumption) process.stdout.write(`${DIM}assumption: ${result.assumption}${RESET}\n`);

  for (const option of result.options || []) {
    process.stdout.write(`\n${BOLD}${option.label}${RESET} -> ${option.wouldAnswer}\n${DIM}${option.sql}${RESET}\n`);
  }

  if (result.evidence) {
    process.stdout.write(`\n${DIM}${result.evidence.sql}${RESET}\n\n`);
    process.stdout.write(`${table(result.evidence.columns, result.evidence.rows.slice(0, 30))}\n`);
    process.stdout.write(`${DIM}${result.evidence.rowCount} rows · ${result.evidence.durationMs} ms${RESET}\n`);
  }

  process.stdout.write(`${DIM}verification: ${result.verification} · trace ${result.traceId}${RESET}\n`);
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const question = args.filter((arg) => !arg.startsWith('--')).join(' ');
const engine = new Engine();

if (question) {
  const result = await engine.ask(question);
  if (asJson) process.stdout.write(`${JSON.stringify(toResponse(result), null, 2)}\n`);
  else show(result);
} else {
  process.stdout.write(`${DIM}provider: ${engine.client.name} · ctrl-c to exit${RESET}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  for (;;) {
    const input = (await rl.question('\nask> ')).trim();
    if (!input) continue;
    if (input === 'exit' || input === 'quit') break;
    show(await engine.ask(input));
  }
  rl.close();
}

closeDb();
process.exit(0);
