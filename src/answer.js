import { config } from './config.js';

export const NARRATOR_SYSTEM = `You write one short, plain-English answer to a business question, using ONLY the
data rows provided.

- Every number you write must appear in the rows. Never estimate or recall one.
- If the rows do not answer the question, say so. Do not fill the gap.
- Two or three sentences; bullets only for more than three items.
- Use the units and currency exactly as they appear.
- Do not mention SQL, tables, or that you were given rows.`;

const NUMBER = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+/g;

export function numbersIn(text) {
  return (String(text).match(NUMBER) || []).map((raw) => Number(raw.replace(/,/g, ''))).filter(Number.isFinite);
}

function label(column) {
  return String(column).replace(/(?<!^)(?=[A-Z])/g, ' ').trim();
}

function format(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function render(result) {
  const lines = [];

  if (result.rowCount === 1 && result.columns.length === 1) {
    lines.push(`${label(result.columns[0])}: ${format(result.rows[0][0])}.`);
  } else if (result.rowCount === 1) {
    lines.push(`${result.columns.map((column, i) => `${label(column)} ${format(result.rows[0][i])}`).join(', ')}.`);
  } else {
    const head = result.rows.slice(0, 5);
    lines.push(`${result.rowCount} row(s) returned. Top results:`);
    for (const row of head) {
      lines.push(`  - ${result.columns.map((column, i) => `${label(column)} ${format(row[i])}`).join(', ')}`);
    }
    if (result.rowCount > head.length) lines.push(`  ... and ${result.rowCount - head.length} more.`);
  }

  if (result.truncated) lines.push(`Note: capped at the ${config.maxRows}-row safety limit.`);
  return lines.join('\n');
}

export function verify(text, result, question) {
  const claimed = numbersIn(text);
  if (!claimed.length) return { grounded: true, checked: 0, label: 'grounded (no numeric claims)' };

  const allowed = [...result.numbers(), result.rowCount, ...numbersIn(question)];
  for (const row of result.rows) {
    for (const cell of row) if (typeof cell === 'string') allowed.push(...numbersIn(cell));
  }

  const total = result.numbers().reduce((sum, value) => sum + value, 0);
  if (total) {
    for (const value of result.numbers()) {
      for (const dp of [0, 1, 2]) allowed.push(Number(((100 * value) / total).toFixed(dp)));
    }
  }

  const supported = (value) =>
    allowed.some(
      (candidate) =>
        candidate === value ||
        Math.abs(candidate - value) <= Math.max(config.numericTolerance * Math.max(Math.abs(candidate), Math.abs(value)), 1e-9) ||
        [0, 1, 2, 3].some((dp) => Number(candidate.toFixed(dp)) === Number(value.toFixed(dp)))
    );

  const unsupported = claimed.filter((value) => !supported(value));

  return {
    grounded: !unsupported.length,
    checked: claimed.length,
    unsupported,
    label: unsupported.length
      ? `UNGROUNDED - ${unsupported.length} number(s) not in the rows`
      : `grounded (${claimed.length} numbers traced to rows)`
  };
}

function rowsAsText(result, limit = 50) {
  const lines = [result.columns.join(' | ')];
  for (const row of result.rows.slice(0, limit)) {
    lines.push(row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | '));
  }
  if (result.rowCount > limit) lines.push(`... (${result.rowCount - limit} more rows)`);
  return lines.join('\n');
}

export async function narrate(question, result, client, assumption = '') {
  if (result.rowCount === 0) {
    return { text: 'The query ran but returned no rows, so there is no data matching that question.', deterministic: true };
  }

  if (client.name === 'offline') return { text: render(result), deterministic: true };

  let user = `Question: ${question}\n\nData rows:\n${rowsAsText(result)}\n`;
  if (assumption) user += `\nAssumption made when querying (mention it briefly): ${assumption}\n`;

  try {
    const response = await client.complete(NARRATOR_SYSTEM, user);
    return { text: response.text.trim(), usage: response, deterministic: false };
  } catch {
    return { text: render(result), deterministic: true };
  }
}
