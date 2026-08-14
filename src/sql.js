import sqlParser from 'node-sql-parser';

import { config } from './config.js';

const { Parser } = sqlParser;
const parser = new Parser();
const DIALECT = { database: 'sqlite' };

const FORBIDDEN_FUNCTIONS = new Set([
  'load_extension',
  'readfile',
  'writefile',
  'edit',
  'fts3_tokenizer',
  'sqlite_compileoption_used',
  'sqlite_source_id',
  'randomblob',
  'zeroblob'
]);

const FORBIDDEN_TABLES = new Set(['sqlite_master', 'sqlite_temp_master', 'sqlite_sequence', 'sqlite_stat1']);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.stage = 'validate';
  }
}

export function stripFences(sql) {
  let out = String(sql).trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '');
  }
  return out.trim().replace(/;+\s*$/, '').trim();
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, seen);
    return;
  }

  visit(node);
  for (const value of Object.values(node)) walk(value, visit, seen);
}

function collectCteNames(ast) {
  const names = new Set();
  walk(ast, (node) => {
    if (node.with && Array.isArray(node.with)) {
      for (const cte of node.with) {
        const name = cte?.name?.value ?? cte?.name;
        if (typeof name === 'string') names.add(name.toLowerCase());
      }
    }
  });
  return names;
}

function collectTables(ast) {
  const found = [];
  walk(ast, (node) => {
    if (node.table && (node.as !== undefined || node.db !== undefined) && typeof node.table === 'string') {
      found.push({ table: node.table, alias: node.as || node.table });
    }
  });
  return found;
}

function collectColumns(ast) {
  const found = [];
  walk(ast, (node) => {
    if (node.type === 'column_ref' && typeof node.column === 'string') {
      found.push({ table: node.table || '', column: node.column });
    }
  });
  return found;
}

function collectAliases(ast) {
  const aliases = new Set();
  walk(ast, (node) => {
    if (node.expr && typeof node.as === 'string' && node.as) aliases.add(node.as.toLowerCase());
  });
  return aliases;
}

function applyLimit(ast, maxRows) {
  const existing = ast.limit;
  const bounded = { seperator: '', value: [{ type: 'number', value: maxRows }] };

  if (!existing || !Array.isArray(existing.value) || existing.value.length === 0) {
    ast.limit = bounded;
    return true;
  }

  const last = existing.value[existing.value.length - 1];
  if (typeof last?.value !== 'number' || last.value > maxRows) {
    ast.limit = bounded;
    return true;
  }
  return false;
}

export function validate(rawSql, catalog, maxRows = config.maxRows) {
  const sql = stripFences(rawSql);

  let parsed;
  try {
    parsed = parser.astify(sql, DIALECT);
  } catch (error) {
    throw new ValidationError(`SQL failed to parse: ${String(error.message).split('\n')[0]}`);
  }

  const statements = Array.isArray(parsed) ? parsed : [parsed];
  if (statements.length !== 1) {
    throw new ValidationError(
      `expected exactly 1 statement, found ${statements.length}; stacked statements are not permitted`
    );
  }

  const ast = statements[0];
  if (ast.type !== 'select') {
    throw new ValidationError(`only SELECT queries are permitted, got ${String(ast.type).toUpperCase()}`);
  }

  walk(ast, (node) => {
    if (node.type === 'function' || node.type === 'aggr_func') {
      const name = String(node.name?.name?.[0]?.value ?? node.name ?? '').toLowerCase();
      if (FORBIDDEN_FUNCTIONS.has(name)) throw new ValidationError(`forbidden function: ${name}()`);
    }
  });

  const cteNames = collectCteNames(ast);
  const aliasToTable = new Map();
  const referenced = new Set();

  for (const { table, alias } of collectTables(ast)) {
    if (FORBIDDEN_TABLES.has(table.toLowerCase())) {
      throw new ValidationError(`access to internal table '${table}' is not permitted`);
    }
    if (cteNames.has(table.toLowerCase())) continue;

    const canonical = catalog.canonicalTable(table);
    if (!canonical) {
      throw new ValidationError(
        `unknown table '${table}' - it does not exist in the catalog. Available: ${catalog.tableNames.sort().join(', ')}`
      );
    }
    referenced.add(canonical);
    aliasToTable.set(String(alias).toLowerCase(), canonical);
  }

  if (referenced.size === 0 && cteNames.size === 0) {
    throw new ValidationError('query references no known tables');
  }

  const knownColumns = new Set(catalog.allColumns.map((c) => c.toLowerCase()));
  const outputAliases = collectAliases(ast);
  for (const name of cteNames) outputAliases.add(name);

  const usedColumns = new Set();
  for (const { table, column } of collectColumns(ast)) {
    if (column === '*') continue;
    const qualifier = table.toLowerCase();

    if (qualifier && aliasToTable.has(qualifier)) {
      const owner = aliasToTable.get(qualifier);
      const ownerColumns = new Set(catalog.columnsOf(owner).map((c) => c.toLowerCase()));
      if (!ownerColumns.has(column.toLowerCase()) && !outputAliases.has(column.toLowerCase())) {
        throw new ValidationError(
          `unknown column ${qualifier}.${column} - ${owner} has no such column. ` +
            `Columns: ${catalog.columnsOf(owner).sort().join(', ')}`
        );
      }
      usedColumns.add(`${owner}.${column}`);
      continue;
    }

    if (!knownColumns.has(column.toLowerCase()) && !outputAliases.has(column.toLowerCase())) {
      throw new ValidationError(`unknown column '${column}' - no table in the catalog has this column`);
    }
    usedColumns.add(column);
  }

  const limitInjected = applyLimit(ast, maxRows);

  return {
    sql: parser.sqlify(ast, DIALECT).replace(/`/g, ''),
    originalSql: sql,
    tables: [...referenced].sort(),
    columns: [...usedColumns].sort(),
    limitInjected
  };
}
