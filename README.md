# Talk to your data

![architecture](docs/architecture.png)

## Quick start

```bash
npm run setup              # install + download Chinook (~1 MB)
npm test                   
npm run eval              
npm start                
```

- Works with **no API key** — a rule-based planner stands in so you can run everything offline.
- For real answers: `export GROQ_API_KEY=gsk_...`, then `npm run smoke` to check the key, then restart.
- CLI: `npm run ask -- "which genre made the most revenue?"` · plain `npm run ask` opens a REPL.
- Check which planner you're on: `curl localhost:8000/health` → `"provider": "groq"` or `"offline"`.

```bash
npm i -g vercel
vercel            
vercel --prod
```

## What it does

- **Answers** — *"which genre made the most revenue?"* → Rock, $826.65, with the SQL and rows.
- **Asks** — *"who is our best customer?"* → runs both readings, sees they disagree (Helena Holý by spend, Aaron Mitchell by frequency), asks which you meant.
- **Refuses** — *"what's the profit margin?"* → says there's no cost data, suggests what it *can* answer.
- **Shows its work live** — the pipeline strip lights up stage by stage as the question runs (streamed over SSE).
- **Remembers** — the History tab keeps the last 25 questions with their answer, SQL and rows in a dropdown.
- **Doesn't repeat work** — the same question inside 5 minutes is served from cache, no model call.

![answer](docs/screenshots/answer.png)
![live pipeline](docs/screenshots/flow-live.png)
![ambiguous](docs/screenshots/ambiguous.png)
![history](docs/screenshots/history.png)


## How it works

One model call, wrapped in checks that don't depend on the model behaving.

| Step | File | What it does |
|---|---|---|
| retrieve | `src/catalog.js` | Picks the few tables the question needs. Never dumps the whole schema. |
| plan | `src/planner.js` | The one model call. Returns `sql`, `clarify`, or `refuse` as JSON. |
| probe | `src/pipeline.js` | For `clarify`: runs every reading and compares. Same answer → just answer. Different → ask. |
| validate | `src/sql.js` | Parses the SQL. SELECT only, real tables and columns only, row cap applied. |
| execute | `src/db.js` | Read-only connection, `query_only` on, statement must be a reader, stops at the cap. |
| narrate | `src/answer.js` | Writes the answer from the rows alone — it never sees the schema or the SQL. |
| verify | `src/answer.js` | Every number in the answer must appear in the rows, or the prose is thrown away. |

**Why the probe matters.** "Is this ambiguous?" is unanswerable in the abstract — it
only matters if the readings give *different* answers. So we run them and find out.

**Why numbers get verified.** The narrator only ever sees rows, so the cheapest way for
it to answer is to actually read them. Then every number it writes is checked against
the result set.

## Layout

```
src/
  server.js       express app + routes
  middleware.js   requestId, logger, rateLimit, validateQuestion, idempotency, errors
  ui.js           the web page (Ask + History tabs)
  cli.js          terminal version
  pipeline.js     the engine: plan -> probe -> validate -> execute -> narrate -> verify
  planner.js      the model prompt and the plan contract
  catalog.js      catalog loader, table retrieval, drift check
  catalog.yaml    the semantic layer
  sql.js          the SQL safety gate
  db.js           read-only SQLite access
  answer.js       narration, rendering, number verification
  llm.js          Groq client + offline rule planner
  cache.js        idempotency cache + history
  config.js       every tunable in one object
eval/             benchmark.yaml (16 questions) + harness.js
test/             56 tests
```


## API

```bash
curl -XPOST localhost:8000/ask -H 'content-type: application/json' \
     -d '{"question":"which country has the most customers?"}'
```

- `POST /ask` → `{ outcome, answer, assumption, options, evidence, verification, cached, traceId }`
- `GET /ask/stream?q=...` → SSE: a `stage` event per pipeline step, then one `result` event. The UI falls back to `POST /ask` if streaming is blocked.
- `GET /history` → last 25 questions with SQL and rows
- `GET /health` → which planner is running
- `GET /schema` → the catalog as the model sees it