import { loadCatalog } from '../src/catalog.js';
import { closeDb } from '../src/db.js';
import { getClient } from '../src/llm.js';
import { parsePlan, SYSTEM_PROMPT } from '../src/planner.js';
import { validate, ValidationError } from '../src/sql.js';

const write = (line) => process.stdout.write(`${line}\n`);
const question = process.argv.slice(2).join(' ') || 'Which sales support employee generated the most revenue?';

const client = getClient();
const catalog = loadCatalog();

write(`provider : ${client.name}`);
write(`model    : ${client.model}`);
if (client.name === 'offline') write('\nNo GROQ_API_KEY here, so this is the offline rule planner.\n');
write(`question : ${question}`);

const context = catalog.context(question);
write(`context  : ${context.length} chars, ${catalog.retrieve(question).length}/${catalog.tableNames.length} tables\n`);

let response;
try {
  response = await client.complete(SYSTEM_PROMPT, `${context}\n\n## Question\n${question}\n`);
} catch (error) {
  write(`CALL FAILED: ${error.message}`);
  process.exit(1);
}

write(`latency  : ${response.latencyMs.toFixed(0)} ms`);
write(`tokens   : ${response.inputTokens} in / ${response.outputTokens} out`);
write(`\n--- raw model output ---\n${response.text.trim().slice(0, 1500)}`);

const plan = parsePlan(response.text);
write(`\n--- parsed ---\nkind: ${plan.kind}`);
if (plan.assumption) write(`assumption: ${plan.assumption}`);

if (plan.kind === 'sql') {
  try {
    write(`\n--- validated sql ---\n${validate(plan.sql, catalog).sql}\n\nvalidator: ACCEPTED`);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    write(`\nvalidator: REJECTED - ${error.message}`);
  }
}

closeDb();
