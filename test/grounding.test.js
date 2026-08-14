import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { verify } from '../src/answer.js';
import { loadCatalog } from '../src/catalog.js';
import { closeDb, execute } from '../src/db.js';
import { offlinePlan } from '../src/llm.js';
import { parsePlan, PlanError } from '../src/planner.js';
import { grade } from '../eval/harness.js';

const catalog = loadCatalog();

after(() => closeDb());

describe('grounding check', () => {
  it('catches a made-up number', () => {
    const result = execute('SELECT COUNT(*) AS n FROM Customer');
    const verdict = verify('We have 4,812 customers.', result, 'how many customers?');
    assert.equal(verdict.grounded, false);
  });

  it('accepts a real number', () => {
    const result = execute('SELECT COUNT(*) AS n FROM Customer');
    assert.equal(verify('There are 59 customers.', result, 'how many?').grounded, true);
  });

  it('allows rounding for readability', () => {
    const result = execute('SELECT 1040.4899999 AS Revenue');
    assert.equal(verify('Revenue was $1,040.49.', result, 'revenue?').grounded, true);
  });

  it('allows numbers that came from the question', () => {
    const result = execute('SELECT Name FROM Track ORDER BY Milliseconds DESC LIMIT 5');
    assert.equal(verify('Here are the 5 longest tracks.', result, 'the 5 longest tracks').grounded, true);
  });
});

describe('plan contract', () => {
  it('needs a valid kind', () => assert.throws(() => parsePlan('{"kind":"guess"}'), PlanError));
  it('needs sql when kind is sql', () => assert.throws(() => parsePlan('{"kind":"sql","sql":""}'), PlanError));
  it('needs options when kind is clarify', () => assert.throws(() => parsePlan('{"kind":"clarify"}'), PlanError));

  it('survives a chatty model', () => {
    const plan = parsePlan('Sure!\n```json\n{"kind":"refuse","missing_concept":"cost","explanation":"none"}\n```');
    assert.equal(plan.kind, 'refuse');
  });
});

describe('catalog', () => {
  it('pulls the joins a revenue question needs', () => {
    const tables = catalog.retrieve('what is total sales revenue by country?');
    for (const table of ['Customer', 'Invoice', 'InvoiceLine']) assert.ok(tables.includes(table));
  });

  it('sends a subset, not the whole schema', () => {
    assert.ok(catalog.retrieve('how many customers are there?').length < catalog.tableNames.length);
  });

  it('spots concepts the database does not have', () => {
    assert.ok(catalog.missingConcepts('what is the profit margin?').length > 0);
    assert.equal(catalog.missingConcepts('what is total revenue by country?').length, 0);
  });
});

describe('limit handling', () => {
  it('drops the limit when the user asks for everything', () => {
    const plan = offlinePlan('## Question\nlist all employees with title containing sales, dont limit them');
    assert.equal(plan.kind, 'sql');
    assert.ok(!/LIMIT/i.test(plan.sql));
    assert.match(plan.sql, /Title LIKE/);
  });

  it('keeps a top-N when the user asks for one', () => {
    const plan = offlinePlan('## Question\nwhich employee generated the most revenue?');
    assert.match(plan.sql, /LIMIT/);
  });
});

describe('the grader can fail', () => {
  it('catches the fan-out bug', () => {
    const buggy = execute(
      "SELECT c.FirstName || ' ' || c.LastName AS Customer, ROUND(SUM(i.Total), 2) AS Revenue " +
        'FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId ' +
        'JOIN InvoiceLine il ON il.InvoiceId = i.InvoiceId ' +
        "WHERE c.Country = 'Brazil' GROUP BY c.CustomerId ORDER BY Revenue DESC LIMIT 3"
    );

    const result = grade(
      {
        id: 'fanout',
        question: 'revenue per customer in Brazil',
        category: 'fan-out trap',
        expect: 'answer',
        topK: 3,
        ordered: true,
        mustMention: [],
        needsAssumption: false,
        goldSql: `SELECT c.FirstName || ' ' || c.LastName, ROUND(SUM(il.UnitPrice*il.Quantity),2)
                  FROM Customer c JOIN Invoice i ON i.CustomerId=c.CustomerId
                  JOIN InvoiceLine il ON il.InvoiceId=i.InvoiceId
                  WHERE c.Country='Brazil' GROUP BY c.CustomerId ORDER BY 2 DESC LIMIT 3`
      },
      {
        outcome: 'answer',
        answer: 'Top Brazilian customers.',
        assumption: '',
        grounded: true,
        evidence: { rows: buggy.rows, columns: buggy.columns, rowCount: buggy.rowCount }
      }
    );

    assert.equal(result.passed, false);
    assert.equal(result.failure, 'wrong-value');
  });
});
