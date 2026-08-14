import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import Database from 'better-sqlite3';

import { loadCatalog } from '../src/catalog.js';
import { config } from '../src/config.js';
import { closeDb, execute, ExecutionError } from '../src/db.js';
import { validate, ValidationError } from '../src/sql.js';

const catalog = loadCatalog();
const check = (sql) => validate(sql, catalog);

after(() => closeDb());

describe('sql guard', () => {
  const hostile = [
    'DROP TABLE Customer',
    'DELETE FROM Customer',
    "UPDATE Customer SET Country = 'X'",
    "INSERT INTO Customer (FirstName) VALUES ('x')",
    'CREATE TABLE evil (a int)',
    'ALTER TABLE Customer ADD COLUMN x int',
    'SELECT * FROM Customer; DROP TABLE Customer',
    "ATTACH DATABASE '/tmp/e.db' AS e",
    'PRAGMA writable_schema = 1',
    'VACUUM',
    "SELECT load_extension('/tmp/evil.so')",
    "SELECT readfile('/etc/passwd')",
    'SELECT * FROM sqlite_master'
  ];

  for (const sql of hostile) {
    it(`rejects ${sql.slice(0, 42)}`, () => assert.throws(() => check(sql), ValidationError));
  }

  const fine = [
    'SELECT COUNT(*) FROM Customer',
    'SELECT c.Country FROM Customer c JOIN Invoice i ON i.CustomerId = c.CustomerId',
    'WITH t AS (SELECT Country FROM Customer) SELECT Country FROM t',
    'SELECT Country, COUNT(*) AS n FROM Customer GROUP BY Country HAVING n > 2'
  ];

  for (const sql of fine) {
    it(`accepts ${sql.slice(0, 42)}`, () => assert.ok(check(sql).sql));
  }

  it('rejects a made-up column before running anything', () => {
    assert.throws(() => check('SELECT t.PlayCount FROM Track t'), /unknown column/);
  });

  it('rejects a made-up table', () => {
    assert.throws(() => check('SELECT * FROM StreamingEvents'), /unknown table/);
  });

  it('says what is wrong so the planner can fix it', () => {
    try {
      check('SELECT t.PlayCount FROM Track t');
      assert.fail('should have thrown');
    } catch (error) {
      assert.match(error.message, /PlayCount/);
      assert.match(error.message, /Milliseconds/);
    }
  });
});

describe('row limits', () => {
  it('adds a cap when the query has none', () => {
    const result = check('SELECT * FROM Track');
    assert.equal(result.limitInjected, true);
    assert.match(result.sql, new RegExp(String(config.maxRows)));
  });

  it('clamps a huge limit', () => {
    assert.match(check('SELECT * FROM Track LIMIT 999999').sql, new RegExp(String(config.maxRows)));
  });

  it('keeps a small limit the user asked for', () => {
    const result = check('SELECT Name FROM Track LIMIT 5');
    assert.equal(result.limitInjected, false);
    assert.match(result.sql, /LIMIT 5/);
  });

  it('strips markdown fences', () => {
    assert.ok(check('```sql\nSELECT COUNT(*) FROM Customer\n```').sql);
  });
});

describe('database sandbox', () => {
  it('blocks writes sent straight to the executor', () => {
    for (const sql of ['DELETE FROM Customer', "UPDATE Customer SET Country='X'", 'DROP TABLE Invoice']) {
      assert.throws(() => execute(sql), ExecutionError);
    }
  });

  it('leaves the data untouched after an attack', () => {
    const count = () => {
      const db = new Database(config.dbPath, { readonly: true });
      try {
        return db.prepare('SELECT COUNT(*) AS n FROM Customer').get().n;
      } finally {
        db.close();
      }
    };

    const before = count();
    for (const sql of ['DELETE FROM Customer', 'DROP TABLE Customer']) assert.throws(() => execute(sql));
    assert.equal(count(), before);
    assert.equal(before, 59);
  });

  it('stops reading at the row cap', () => {
    const result = execute('SELECT * FROM Track', 10);
    assert.equal(result.rowCount, 10);
    assert.equal(result.truncated, true);
  });
});
