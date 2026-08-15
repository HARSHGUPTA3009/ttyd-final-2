import { narrate, render, verify } from './answer.js';
import { loadCatalog } from './catalog.js';
import { config } from './config.js';
import { execute, ExecutionError } from './db.js';
import { getClient } from './llm.js';
import { checkBindings, plan, PlanError, SYSTEM_PROMPT } from './planner.js';
import { validate, ValidationError } from './sql.js';
import { digestRows, hash, writeTrace } from './trace.js';

function headline(result) {
  if (!result.rowCount) return '<no rows>';
  const row = result.rows[0];
  const names = row.filter((cell) => typeof cell === 'string');
  if (names.length) return names.join(' | ');
  return row.map((cell) => (typeof cell === 'number' ? cell.toFixed(2) : String(cell))).join(' | ');
}

export class Engine {
  constructor({ client, catalog } = {}) {
    this.catalog = catalog || loadCatalog();
    this.client = client || getClient();
  }

  async ask(question, onStage = () => {}) {
    const startedAt = performance.now();
    const emit = (stage, status, detail = '') => {
      try {
        onStage({ stage, status, detail, atMs: Number((performance.now() - startedAt).toFixed(1)) });
      } catch {
        return;
      }
    };
    const trace = {
      at: new Date().toISOString(),
      question,
      provider: this.client.name,
      model: this.client.model,
      tables: this.catalog.retrieve(question),
      attempts: [],
      inputTokens: 0,
      outputTokens: 0
    };

    let result;
    try {
      result = await this.run(question, trace, emit);
    } catch (error) {
      emit('error', 'fail', error.message);
      result = {
        outcome: 'error',
        answer:
          error.stage === 'plan'
            ? `I could not build a valid plan for that question. (${error.message})`
            : `Something went wrong: ${error.message}`,
        assumption: '',
        options: [],
        evidence: null,
        verification: 'n/a - the request failed',
        grounded: true,
        confidence: 0
      };
    }

    emit('done', 'ok', result.outcome);
    trace.outcome = result.outcome;
    trace.answer = result.answer;
    trace.latencyMs = Number((performance.now() - startedAt).toFixed(1));
    trace.id = hash(`${question}|${this.catalog.context(question)}|${SYSTEM_PROMPT}|${this.client.model}`);
    writeTrace(trace);

    return { question, traceId: trace.id, latencyMs: trace.latencyMs, cached: false, ...result, trace };
  }

  async run(question, trace, emit) {
    emit('retrieve', 'run');
    emit('retrieve', 'ok', trace.tables.join(', '));

    emit('plan', 'run');
    const chosen = await this.plan(question, trace);
    trace.planKind = chosen.kind;
    emit('plan', 'ok', chosen.kind);

    if (chosen.usage) {
      trace.inputTokens += chosen.usage.inputTokens;
      trace.outputTokens += chosen.usage.outputTokens;
    }

    if (chosen.kind === 'refuse') {
      emit('refuse', 'ok', chosen.missingConcept);
      return this.refuse(chosen);
    }

    if (chosen.kind === 'clarify') {
      emit('probe', 'run', `${chosen.options.length} readings`);
      return this.probe(chosen, question, trace, emit);
    }

    return this.answer(question, chosen.sql, chosen.assumption, chosen.confidence, trace, emit);
  }

  async plan(question, trace) {
    let hint = '';

    for (let attempt = 0; attempt <= config.maxRepairAttempts; attempt += 1) {
      let candidate;

      try {
        candidate = await plan(question, this.catalog, this.client, hint);
      } catch (error) {
        if (attempt === config.maxRepairAttempts) throw error;
        hint = error.message;
        trace.attempts.push({ stage: 'plan', error: hint });
        continue;
      }

      if (candidate.kind !== 'sql') return candidate;

      try {
        validate(candidate.sql, this.catalog);
        return candidate;
      } catch (error) {
        trace.attempts.push({ stage: 'validate', sql: candidate.sql, error: error.message });
        if (attempt === config.maxRepairAttempts) throw new PlanError(`SQL rejected by the validator: ${error.message}`);
        hint = `Your SQL was rejected: ${error.message}`;
      }
    }

    throw new PlanError('planning failed');
  }

  refuse(chosen) {
    let answer = `I can't answer that from this data: ${chosen.explanation || 'the required data is missing'}`;
    if (chosen.nearestAnswerable) answer += `\n\nWhat I can answer instead: "${chosen.nearestAnswerable}"`;

    return {
      outcome: 'refuse',
      answer,
      assumption: '',
      options: [],
      evidence: null,
      verification: 'n/a - no query was run',
      grounded: true,
      confidence: chosen.confidence
    };
  }

  probe(chosen, question, trace, emit = () => {}) {
    const runs = [];

    for (const option of chosen.options.slice(0, 4)) {
      try {
        const checked = validate(option.sql, this.catalog);
        const result = execute(checked.sql);
        if (result.rowCount) runs.push({ option, result, sql: checked.sql });
      } catch (error) {
        if (!(error instanceof ValidationError) && !(error instanceof ExecutionError)) throw error;
        trace.attempts.push({ stage: 'probe', sql: option.sql, error: error.message });
      }
    }

    const distinct = new Set(runs.map(({ result }) => headline(result)));
    trace.probe = { readings: runs.map(({ option }) => option.label), agreed: distinct.size === 1 };

    if (runs.length >= 2 && distinct.size === 1) {
      emit('probe', 'ok', 'readings agree');
      const [chosenRun, ...others] = runs;
      const names = others.map(({ option }) => `"${option.label}"`).join(', ');

      return this.answer(
        question,
        chosenRun.sql,
        `Read as ${chosenRun.option.label}. The other reading${others.length > 1 ? 's' : ''} (${names}) give the same answer, so the difference does not matter here.`,
        chosen.confidence,
        trace,
        emit
      );
    }

    const options = runs.map(({ option, result, sql }) => ({
      label: option.label,
      sql,
      wouldAnswer: headline(result)
    }));

    emit('probe', 'ok', 'readings disagree, asking');
    let answer = chosen.clarifyingQuestion || 'That question has more than one reasonable reading - which did you mean?';
    if (options.length) {
      answer += "\n\nThe readings give different answers, which is why I'm asking:";
      for (const option of options) answer += `\n  - ${option.label} -> ${option.wouldAnswer}`;
    }

    return {
      outcome: 'clarify',
      answer,
      assumption: '',
      options,
      evidence: null,
      verification: 'n/a - awaiting clarification',
      grounded: true,
      confidence: chosen.confidence
    };
  }

  async answer(question, rawSql, assumption, confidence, trace, emit = () => {}) {
    emit('validate', 'run');
    const checked = validate(rawSql, this.catalog);
    emit('validate', 'ok', checked.tables.join(', '));

    emit('execute', 'run');
    const result = execute(checked.sql);
    emit('execute', 'ok', `${result.rowCount} rows in ${result.durationMs} ms`);

    trace.sql = checked.sql;
    trace.rowCount = result.rowCount;
    trace.rowsDigest = digestRows(result.columns, result.rows);

    emit('narrate', 'run');
    const narrated = await narrate(question, result, this.client, assumption);
    emit('narrate', 'ok');
    emit('verify', 'run');
    if (narrated.usage) {
      trace.inputTokens += narrated.usage.inputTokens;
      trace.outputTokens += narrated.usage.outputTokens;
    }

    let text = narrated.text;
    let verdict = narrated.deterministic
      ? { grounded: true, label: 'grounded (rendered straight from the rows)' }
      : verify(text, result, question);

    if (!verdict.grounded) {
      text = render(result);
      verdict = { grounded: true, label: 'model answer failed the grounding check and was replaced by the raw rows' };
      trace.degraded = true;
      emit('verify', 'warn', 'ungrounded prose replaced by raw rows');
    } else {
      emit('verify', 'ok', verdict.label);
    }

    trace.verification = verdict.label;

    return {
      outcome: 'answer',
      answer: text,
      assumption: assumption || '',
      options: [],
      evidence: {
        sql: checked.sql,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
        tables: checked.tables,
        durationMs: result.durationMs
      },
      verification: verdict.label,
      grounded: verdict.grounded,
      confidence
    };
  }
}

export function toResponse(result) {
  return {
    question: result.question,
    outcome: result.outcome,
    answer: result.answer,
    assumption: result.assumption,
    options: result.options,
    evidence: result.evidence,
    verification: result.verification,
    grounded: result.grounded,
    confidence: result.confidence,
    traceId: result.traceId,
    latencyMs: result.latencyMs,
    cached: result.cached === true
  };
}
