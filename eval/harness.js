import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import YAML from 'yaml';

import { numbersIn } from '../src/answer.js';
import { clearCache } from '../src/cache.js';
import { config } from '../src/config.js';
import { closeDb } from '../src/db.js';
import { Engine } from '../src/pipeline.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOLERANCE = 0.005;

export function loadCases() {
  return YAML.parse(readFileSync(join(HERE, 'benchmark.yaml'), 'utf8')).map((raw) => ({
    id: raw.id,
    question: raw.question,
    category: raw.category || '',
    expect: raw.expect || 'answer',
    goldSql: raw.gold_sql || '',
    topK: raw.top_k || 3,
    ordered: Boolean(raw.ordered),
    mustMention: raw.must_mention || [],
    needsAssumption: Boolean(raw.requires_assumption)
  }));
}

function goldRows(sql) {
  const db = new Database(config.dbPath, { readonly: true });
  try {
    return db.prepare(sql).raw(true).all();
  } finally {
    db.close();
  }
}

const sameNumber = (a, b) =>
  a === b ||
  Math.abs(a - b) <= Math.max(TOLERANCE * Math.max(Math.abs(a), Math.abs(b)), 1e-9) ||
  [0, 1, 2].some((dp) => Number(a.toFixed(dp)) === Number(b.toFixed(dp)));

export const normalise = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function present(cell, rows, text) {
  if (cell === null || cell === undefined) return true;

  if (typeof cell === 'number') {
    const inRows = rows.some((row) => row.some((value) => typeof value === 'number' && sameNumber(cell, value)));
    return inRows || numbersIn(text).some((value) => sameNumber(cell, value));
  }

  const needle = normalise(cell);
  if (!needle) return true;
  return rows.some((row) => row.some((value) => normalise(value).includes(needle))) || normalise(text).includes(needle);
}

function orderOk(gold, rows, k) {
  const wanted = gold.slice(0, k).map((row) => normalise(row[0])).filter(Boolean);
  if (wanted.length < 2) return true;

  const width = Math.max(0, ...rows.map((row) => row.length));
  for (let column = 0; column < width; column += 1) {
    const seen = rows.slice(0, k).map((row) => normalise(row[column]));
    if (wanted.every((value, i) => seen[i]?.includes(value))) return true;
  }
  return false;
}

export function grade(testCase, result) {
  const out = {
    id: testCase.id,
    question: testCase.question,
    category: testCase.category,
    expect: testCase.expect,
    got: result.outcome,
    passed: false,
    behaviourOk: false,
    failure: '',
    detail: '',
    latencyMs: result.latencyMs || 0
  };

  if (testCase.expect === 'clarify') {
    out.behaviourOk = result.outcome === 'clarify' || (result.outcome === 'answer' && Boolean(result.assumption.trim()));
    out.failure = out.behaviourOk ? '' : result.outcome === 'answer' ? 'silent-guess' : `wrong-behaviour:${result.outcome}`;
  } else if (testCase.expect === 'refuse') {
    out.behaviourOk = result.outcome === 'refuse';
    out.failure = out.behaviourOk ? '' : result.outcome === 'answer' ? 'hallucinated-answer' : `wrong-behaviour:${result.outcome}`;
  } else {
    out.behaviourOk = result.outcome === 'answer';
    out.failure = out.behaviourOk
      ? ''
      : { refuse: 'over-refusal', clarify: 'over-clarification' }[result.outcome] || `wrong-behaviour:${result.outcome}`;
  }

  if (!out.behaviourOk) {
    out.detail = `expected ${testCase.expect}, got ${result.outcome}`;
    return out;
  }

  if (testCase.expect === 'refuse') {
    const text = normalise(result.answer);
    out.passed = !testCase.mustMention.length || testCase.mustMention.some((term) => text.includes(normalise(term)));
    if (!out.passed) {
      out.failure = 'unexplained-refusal';
      out.detail = `refusal never mentioned any of: ${testCase.mustMention.join(', ')}`;
    }
    return out;
  }

  if (testCase.expect === 'clarify') {
    out.passed = true;
    return out;
  }

  if (testCase.needsAssumption && !result.assumption.trim()) {
    out.failure = 'undeclared-proxy';
    out.detail = 'used a proxy metric without saying so';
    return out;
  }

  if (!result.grounded) {
    out.failure = 'ungrounded-prose';
    out.detail = 'answer contained numbers that are not in the rows';
    return out;
  }

  if (!testCase.goldSql) {
    out.passed = true;
    return out;
  }

  const gold = goldRows(testCase.goldSql);
  const rows = result.evidence?.rows || [];
  const missing = [];

  for (const goldRow of gold.slice(0, testCase.topK)) {
    for (const cell of goldRow) {
      if (!present(cell, rows.slice(0, Math.max(testCase.topK, 5)), result.answer)) missing.push(cell);
    }
  }

  if (missing.length) {
    out.failure = 'wrong-value';
    out.detail = `expected value(s) missing from the result: ${missing.slice(0, 4).join(', ')}`;
    return out;
  }

  if (testCase.ordered && !orderOk(gold, rows, testCase.topK)) {
    out.failure = 'wrong-ordering';
    out.detail = 'rows are not in the expected order';
    return out;
  }

  out.passed = true;
  return out;
}

export async function run({ k = 1 } = {}) {
  const cases = loadCases();
  const engine = new Engine();
  const startedAt = Date.now();
  const signatures = new Map();
  let results = [];

  for (let pass = 0; pass < k; pass += 1) {
    clearCache();
    results = [];

    for (const testCase of cases) {
      const answer = await engine.ask(testCase.question);
      const graded = grade(testCase, answer);
      results.push(graded);

      const seen = signatures.get(testCase.id) || [];
      seen.push(`${answer.outcome}:${answer.trace.rowsDigest || ''}`);
      signatures.set(testCase.id, seen);

      if (k === 1) {
        process.stdout.write(
          `  [${graded.passed ? 'PASS' : 'FAIL'}] ${graded.id}  ${graded.question.slice(0, 54).padEnd(54)} ` +
            `${graded.expect.padEnd(7)} -> ${graded.got}${graded.passed ? '' : `   ${graded.failure}: ${graded.detail}`}\n`
        );
      }
    }
  }

  const byCategory = {};
  for (const result of results) {
    byCategory[result.category] = byCategory[result.category] || { passed: 0, total: 0 };
    byCategory[result.category].total += 1;
    if (result.passed) byCategory[result.category].passed += 1;
  }

  const unstable = k > 1 ? [...signatures].filter(([, list]) => new Set(list).size > 1).map(([id]) => id) : [];

  return {
    provider: engine.client.name,
    model: engine.client.model,
    runs: k,
    cases: cases.length,
    passed: results.filter((result) => result.passed).length,
    behaviourOk: results.filter((result) => result.behaviourOk).length,
    consistency: k > 1 ? Number(((cases.length - unstable.length) / cases.length).toFixed(3)) : null,
    unstable,
    byCategory: Object.fromEntries(Object.entries(byCategory).sort().map(([key, value]) => [key, `${value.passed}/${value.total}`])),
    failures: results.filter((result) => !result.passed),
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    results
  };
}

export function printReport(report) {
  const write = (line) => process.stdout.write(`${line}\n`);
  const pct = (n) => `${((n / report.cases) * 100).toFixed(1)}%`;

  write(`\n${'='.repeat(72)}`);
  write(`provider ${report.provider}/${report.model}   runs ${report.runs}   ${report.seconds}s`);
  if (report.provider === 'offline') write('NOTE: offline rule planner - this measures the pipeline, not a model.');
  write('='.repeat(72));
  write(`  accuracy            ${report.passed}/${report.cases}  ${pct(report.passed)}`);
  write(`  behaviour accuracy  ${report.behaviourOk}/${report.cases}  ${pct(report.behaviourOk)}`);
  if (report.consistency !== null) {
    write(`  consistency         ${(report.consistency * 100).toFixed(1)}%${report.unstable.length ? `  unstable: ${report.unstable.join(', ')}` : ''}`);
  }

  write('\n  by category');
  for (const [category, score] of Object.entries(report.byCategory)) write(`    ${category.padEnd(40)} ${score}`);

  if (report.failures.length) {
    write('\n  failures');
    for (const failure of report.failures) write(`    ${failure.id}  ${failure.failure}: ${failure.detail}`);
  } else {
    write('\n  no failures');
  }
  write(`${'='.repeat(72)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kIndex = process.argv.indexOf('--k');
  const k = kIndex === -1 ? 1 : Number(process.argv[kIndex + 1]);

  process.stdout.write('running benchmark...\n');
  const report = await run({ k });
  printReport(report);

  const target = join(HERE, 'results', k > 1 ? 'latest-k3.json' : 'latest.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2));
  process.stdout.write(`report written to ${target}\n`);

  closeDb();
  process.exit(report.passed === report.cases ? 0 : 1);
}
