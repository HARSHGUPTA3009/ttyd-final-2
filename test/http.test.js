import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { clearCache } from '../src/cache.js';
import { closeDb } from '../src/db.js';
import { getClient, GroqClient, OfflineClient } from '../src/llm.js';
import { createApp } from '../src/server.js';

let server;
let base;

before(async () => {
  clearCache();
  server = createApp(undefined, { quiet: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  closeDb();
});

const ask = (body, headers = {}) =>
  fetch(`${base}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

describe('api', () => {
  it('reports health', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    assert.equal(body.status, 'ok');
  });

  it('answers with the query and rows attached', async () => {
    const body = await (await ask({ question: 'How many customers are there?' })).json();
    assert.equal(body.outcome, 'answer');
    assert.match(body.evidence.sql, /SELECT/i);
    assert.ok(body.evidence.rows.length);
    assert.ok(body.traceId);
  });

  it('asks instead of guessing when a question is ambiguous', async () => {
    const body = await (await ask({ question: 'Who is our best customer?' })).json();
    assert.equal(body.outcome, 'clarify');
    assert.ok(body.options.length >= 2);
  });

  it('refuses when the data is not there', async () => {
    const body = await (await ask({ question: 'What is the profit margin on each album?' })).json();
    assert.equal(body.outcome, 'refuse');
    assert.equal(body.evidence, null);
  });

  it('rejects an empty question', async () => {
    const response = await ask({});
    assert.equal(response.status, 400);
  });

  it('rejects a huge question', async () => {
    assert.equal((await ask({ question: 'x'.repeat(5000) })).status, 413);
  });

  it('404s unknown routes as json', async () => {
    const response = await fetch(`${base}/nope`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'not_found');
  });
});

describe('idempotency', () => {
  it('serves a repeat question from cache', async () => {
    clearCache();
    const question = 'Which country has the most customers?';

    const first = await ask({ question });
    assert.equal(first.headers.get('x-cache'), 'miss');
    assert.equal((await first.json()).cached, false);

    const second = await ask({ question });
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.equal((await second.json()).cached, true);
  });

  it('treats casing and spacing as the same question', async () => {
    clearCache();
    await ask({ question: 'How many customers are there?' });
    const repeat = await ask({ question: '  how many CUSTOMERS are there?  ' });
    assert.equal(repeat.headers.get('x-cache'), 'hit');
  });

  it('collapses concurrent duplicates into one run', async () => {
    clearCache();
    const question = 'What is total sales revenue by country?';
    const [a, b] = await Promise.all([ask({ question }), ask({ question })]);
    const results = await Promise.all([a.json(), b.json()]);
    assert.equal(results[0].traceId, results[1].traceId);
  });

  it('honours a client idempotency key', async () => {
    clearCache();
    const headers = { 'idempotency-key': 'fixed-key-1' };
    await ask({ question: 'How many customers are there?' }, headers);
    const repeat = await ask({ question: 'a totally different question' }, headers);
    assert.equal(repeat.headers.get('x-cache'), 'hit');
  });
});

describe('history', () => {
  it('records questions with their query and rows', async () => {
    clearCache();
    await ask({ question: 'How many customers are there?' });

    const items = await (await fetch(`${base}/history`)).json();
    assert.ok(items.length >= 1);
    assert.equal(items[0].question, 'How many customers are there?');
    assert.match(items[0].sql, /SELECT/i);
    assert.ok(items[0].rows.length);
  });

  it('puts the newest question first', async () => {
    clearCache();
    await ask({ question: 'How many customers are there?' });
    await ask({ question: 'Which country has the most customers?' });

    const items = await (await fetch(`${base}/history`)).json();
    assert.equal(items[0].question, 'Which country has the most customers?');
  });
});

describe('provider', () => {
  it('falls back to the offline planner with no key', () => {
    delete process.env.GROQ_API_KEY;
    assert.ok(getClient() instanceof OfflineClient);
  });

  it('uses groq when a key is set', () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    assert.ok(getClient() instanceof GroqClient);
    delete process.env.GROQ_API_KEY;
  });
});
