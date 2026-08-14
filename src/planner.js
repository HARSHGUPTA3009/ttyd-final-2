export const SYSTEM_PROMPT = `You are the planning stage of an analytics system over a SQLite database.
You do not answer questions. You emit a plan as a single JSON object and nothing
else - no prose, no markdown fences.

Pick exactly one of three kinds.

1. "sql" - one clear reading, answerable from the schema.
{"kind":"sql","sql":"<read-only SELECT>","tables_used":["Table"],
 "columns_used":["Table.Column"],"assumption":"<non-obvious choice, or empty>",
 "confidence":0.0-1.0}

2. "clarify" - two or more materially different readings.
{"kind":"clarify","clarifying_question":"<one short question>",
 "options":[{"label":"<reading>","sql":"<SELECT for it>","tables_used":[],"columns_used":[]}],
 "confidence":0.0-1.0}
Every option must include working SQL: the system runs them and only asks the
user if the readings actually disagree. If one reading is obvious, use "sql"
with an "assumption" instead.

3. "refuse" - the required data is not in the schema.
{"kind":"refuse","missing_concept":"<what is missing>","explanation":"<one sentence>",
 "nearest_answerable":"<a question that CAN be answered>","confidence":0.0-1.0}
Never substitute a lookalike column for a missing concept: price is not cost,
a purchase is not a stream.

Rules:
- SELECT only. No INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/PRAGMA/ATTACH.
- Only the tables and columns listed below exist. Nothing else does.
- Every columns_used entry must be a real Table.Column from that list.
- Follow the metric definitions exactly; they override your intuition.
- LIMIT only when the user asks for a top-N, a "first N", or a single winner.
  If they ask to list, to see all, or say "don't limit", write no LIMIT at all -
  the system applies its own safety cap.
- Apply every filter the user states, including filters on text columns.
- Prefer explicit JOIN ... ON, alias tables, round money to 2 decimals.`;

export class PlanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanError';
    this.stage = 'plan';
  }
}

export function parsePlan(text) {
  let clean = String(text).trim();
  if (clean.startsWith('```')) clean = clean.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '');

  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end <= start) throw new PlanError('no JSON object in model output');
    try {
      data = JSON.parse(clean.slice(start, end + 1));
    } catch (error) {
      throw new PlanError(`plan is not valid JSON: ${error.message}`);
    }
  }

  if (!['sql', 'clarify', 'refuse'].includes(data.kind)) throw new PlanError(`invalid plan kind '${data.kind}'`);

  const plan = {
    kind: data.kind,
    sql: data.sql || '',
    columnsUsed: data.columns_used || [],
    assumption: data.assumption || '',
    clarifyingQuestion: data.clarifying_question || '',
    options: (data.options || []).map((option) => ({
      label: option.label || '',
      sql: option.sql || '',
      columnsUsed: option.columns_used || []
    })),
    missingConcept: data.missing_concept || '',
    explanation: data.explanation || '',
    nearestAnswerable: data.nearest_answerable || '',
    confidence: Number(data.confidence || 0),
    raw: data
  };

  if (plan.kind === 'sql' && !plan.sql.trim()) throw new PlanError("kind is 'sql' but no sql was given");
  if (plan.kind === 'clarify' && !plan.options.length) throw new PlanError("kind is 'clarify' but no options were given");
  if (plan.kind === 'refuse' && !plan.missingConcept) throw new PlanError("kind is 'refuse' but nothing was named as missing");

  return plan;
}

export function checkBindings(plan, catalog) {
  const declared = [...plan.columnsUsed, ...plan.options.flatMap((option) => option.columnsUsed)];
  const known = new Set(catalog.allColumns.map((column) => column.toLowerCase()));

  const unknown = declared.filter((reference) => {
    const [table, column] = String(reference).split('.');
    if (!column) return !known.has(String(reference).toLowerCase());
    return !catalog.columnsOf(table).some((real) => real.toLowerCase() === column.toLowerCase());
  });

  if (unknown.length) {
    throw new PlanError(`plan uses columns that do not exist: ${unknown.join(', ')}`);
  }
}

export async function plan(question, catalog, client, repairHint = '') {
  let user = `${catalog.context(question)}\n\n## Question\n${question}\n`;
  if (repairHint) user += `\n## Your previous attempt was rejected\n${repairHint}\nEmit a corrected plan.\n`;

  const response = await client.complete(SYSTEM_PROMPT, user);
  const parsed = parsePlan(response.text);
  parsed.usage = response;
  checkBindings(parsed, catalog);
  return parsed;
}
