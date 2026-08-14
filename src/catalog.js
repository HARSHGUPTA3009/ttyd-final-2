import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import YAML from 'yaml';

import { config } from './config.js';

const SYNONYMS = {
  Customer: ['customer', 'customers', 'client', 'clients', 'buyer', 'who', 'country', 'countries', 'city'],
  Invoice: ['invoice', 'invoices', 'order', 'orders', 'purchase', 'sale', 'sales', 'revenue', 'spend', 'spent', 'billing', 'date', 'year'],
  InvoiceLine: ['revenue', 'sales', 'sold', 'purchase', 'purchased', 'units', 'quantity', 'popular', 'best', 'top', 'selling'],
  Track: ['track', 'tracks', 'song', 'songs', 'duration', 'length', 'longest', 'minutes', 'price', 'composer'],
  Album: ['album', 'albums', 'record', 'release'],
  Artist: ['artist', 'artists', 'band', 'bands'],
  Genre: ['genre', 'genres', 'rock', 'jazz', 'metal', 'pop', 'latin'],
  Employee: ['employee', 'employees', 'staff', 'rep', 'agent', 'support', 'manager', 'title', 'hired'],
  MediaType: ['media', 'format', 'formats', 'mpeg', 'aac'],
  Playlist: ['playlist', 'playlists'],
  PlaylistTrack: ['playlist', 'playlists']
};

const COMPANIONS = {
  InvoiceLine: ['Invoice'],
  Invoice: ['Customer', 'InvoiceLine'],
  Album: ['Artist'],
  Track: ['Album', 'Genre'],
  PlaylistTrack: ['Playlist', 'Track'],
  Employee: ['Customer']
};

const words = (text) => new Set(String(text).toLowerCase().match(/[a-z]+/g) || []);

class Catalog {
  constructor(raw) {
    this.tables = raw.tables;
    this.metrics = raw.metrics || {};
    this.pitfalls = raw.pitfalls || [];
    this.absentConcepts = raw.absent_concepts || {};
    this.exemplars = raw.exemplars || [];
  }

  get tableNames() {
    return Object.keys(this.tables);
  }

  get allColumns() {
    return [...new Set(this.tableNames.flatMap((name) => this.columnsOf(name)))];
  }

  canonicalTable(name) {
    return this.tableNames.find((known) => known.toLowerCase() === String(name).toLowerCase()) || null;
  }

  columnsOf(table) {
    const key = this.canonicalTable(table);
    return key ? Object.keys(this.tables[key].columns || {}) : [];
  }

  missingConcepts(question) {
    const found = words(question);
    return Object.entries(this.absentConcepts)
      .filter(([concept]) => found.has(concept) || found.has(`${concept}s`))
      .map(([concept, why]) => ({ concept, why }));
  }

  retrieve(question) {
    const found = words(question);
    const scored = [];

    for (const name of this.tableNames) {
      let score = 0;
      if (found.has(name.toLowerCase()) || found.has(`${name.toLowerCase()}s`)) score += 3;
      score += 1.5 * (SYNONYMS[name] || []).filter((word) => found.has(word)).length;
      score += 0.5 * this.columnsOf(name).filter((column) => found.has(column.toLowerCase())).length;
      if (score > 0) scored.push({ name, score });
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const picked = scored.slice(0, config.maxTables).map((entry) => entry.name);
    if (picked.length === 0) picked.push('Customer', 'Invoice', 'InvoiceLine', 'Track');

    for (const name of [...picked]) {
      for (const companion of COMPANIONS[name] || []) {
        if (!picked.includes(companion) && picked.length < config.maxTables) picked.push(companion);
      }
    }
    return picked;
  }

  render(tables) {
    const lines = ['## Tables in scope'];

    for (const name of tables) {
      lines.push(`\n${name} -- ${this.tables[name].description}`);
      for (const [column, description] of Object.entries(this.tables[name].columns)) {
        lines.push(`  - ${name}.${column}: ${description}`);
      }
    }

    lines.push('\n## Metric definitions (authoritative)');
    for (const [key, value] of Object.entries(this.metrics)) {
      lines.push(`  - ${key}: ${String(value).split(/\s+/).join(' ').trim()}`);
    }

    lines.push('\n## Known pitfalls');
    for (const pitfall of this.pitfalls) {
      lines.push(`  - ${String(pitfall).split(/\s+/).join(' ').trim()}`);
    }

    lines.push('\n## Concepts this database does NOT contain');
    for (const [concept, why] of Object.entries(this.absentConcepts)) {
      lines.push(`  - ${concept}: ${why}`);
    }

    lines.push('\n## Worked examples');
    for (const example of this.exemplars) {
      lines.push(`\nQ: ${example.question}\nSQL: ${example.sql.trim()}`);
    }

    return lines.join('\n');
  }

  context(question) {
    const parts = [this.render(this.retrieve(question))];
    const missing = this.missingConcepts(question);

    if (missing.length) {
      parts.push(
        '\n## Retrieval note\nThe question mentions concepts this database does not record:\n' +
          missing.map(({ concept, why }) => `  - ${concept}: ${why}`).join('\n')
      );
    }
    return parts.join('\n');
  }
}

function checkDrift(catalog) {
  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  const problems = [];

  try {
    const live = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      live[name] = db.prepare(`PRAGMA table_info("${name}")`).all().map((column) => column.name);
    }

    for (const table of catalog.tableNames) {
      if (!live[table]) {
        problems.push(`catalog table '${table}' is not in the database`);
        continue;
      }
      const ghosts = catalog.columnsOf(table).filter((column) => !live[table].includes(column));
      if (ghosts.length) problems.push(`${table}: columns not in database: ${ghosts.join(', ')}`);
    }

    for (const table of Object.keys(live)) {
      if (!catalog.tableNames.includes(table)) problems.push(`database table '${table}' is missing from the catalog`);
    }
  } finally {
    db.close();
  }

  if (problems.length) throw new Error(`Catalog does not match the database:\n  - ${problems.join('\n  - ')}`);
}

let cached = null;

export function loadCatalog() {
  if (!cached) {
    cached = new Catalog(YAML.parse(readFileSync(config.catalogPath, 'utf8')));
    checkDrift(cached);
  }
  return cached;
}
