# Written component

---

## 7a · AI usage log

**Tools used.** Claude (Opus) as a pair programmer for the whole build, in a
terminal session with file and shell access. Roughly:

| Used it for | How much I leaned on it |
| --- | --- |
| Scaffolding modules, the Express wiring, CLI rendering | Heavily — this is where it saves real time |
| node-sql-parser AST idioms (walking the tree, rewriting `limit`) | Heavily, then verified each against the library's actual output with tests |
| The web UI markup and CSS | Entirely — it is not graded and I did not want to spend the hour |
| Writing the guardrail tests | Heavily; I added the attack cases I actually cared about (stacked statements, `ATTACH`, `load_extension`, `sqlite_master`) |
| The architecture — the middleware chain, the discriminated union, the ambiguity probe, provenance verification | This was the part I directed. I decided the shape; the model wrote it down |
| The semantic catalog's metric definitions and pitfalls | Mostly me — this is domain knowledge about Chinook, and it is exactly the content that must not be guessed |

**Things it gave me that I rejected or had to fix.**

1. **Regex SQL filtering.** The first instinct — mine and the model's — was to
   block writes with `if (/\b(drop|delete|update)\b/i.test(sql))`. That is
   defeated by `/*x*/DROP`, by casing, by a second statement after a semicolon,
   and by DML nested inside a CTE. I threw it out and rewrote the gate to parse
   SQL to an AST and walk the tree. The parametrised rejection tests in
   `test/guardrails.test.js` are the ones a regex fails.

2. **The ambiguity probe's comparison was wrong on first pass.** The generated
   `headline()` compared the entire first row, including the metric column. That
   means "best customer by spend" (`Helena Holý, 49.62`) and "best customer by
   invoice count" (`Helena Holý, 7`) would be judged as *disagreeing* — the whole
   probe would have collapsed into always asking, which is precisely the
   behaviour it exists to avoid. I changed it to compare the identity cells. This
   is a good example of AI-generated code that runs, passes a naive test, and
   quietly defeats the feature's purpose.

3. **The deterministic renderer was being sent through the verifier — and failed
   its own output.** The renderer emits `... and 19 more.` when it truncates a
   list, and 19 is not a number that appears in any row, so the provenance check
   flagged the system's own formatting as a fabrication and "degraded" it to an
   identical string. Silent, harmless, and completely wrong-headed: verification
   exists to police *model* prose, and the renderer cannot fabricate because it
   only formats. `narrate()` now returns a `deterministic` flag and the verifier
   is skipped for that path. I found this by reading the verdict line in the demo
   output and noticing it did not match what the code should have done.

4. **A worker-thread query timeout that could not work.** An earlier version ran
   every query in a worker and awaited `worker.terminate()` on timeout.
   better-sqlite3 is synchronous, so a worker blocked in a native call cannot be
   preempted — `terminate()` never resolved and the process hung. I removed the
   worker entirely rather than ship a timeout that only looks like one: the row
   cap and the injected `LIMIT` are the real cost bounds, and the README says so.
   Deleting it also removed two files and a whole class of lifecycle bugs.

5. **Hardcoded `LIMIT 3` in the offline planner, which ignored the user.** Asking
   "list all employees whose title contains sales, don't limit them" returned three
   rows of *revenue* data. Two separate bugs behind one symptom: the offline rule
   matched on the word "employee" and returned a canned revenue query, and the
   planner prompt never told the model when *not* to add a LIMIT. Fixed both — the
   rule now branches on whether revenue was actually asked for and applies the text
   filter, and the prompt says to omit LIMIT unless a top-N was requested. Good
   reminder that a demo answering plausibly is not the same as answering the question.

6. **The catalog drift check was not suggested; I added it.** Once the catalog
   became the security allow-list rather than just prompt context, a hand-written
   file silently disagreeing with the real database becomes a correctness *and*
   safety issue. `assertMatchesDatabase()` makes that a startup crash.

**What I would not be comfortable defending on the spot.**

- **node-sql-parser's AST shape.** I know what my `walk()` does; I do not know the
  parser's node taxonomy well enough to swear that no exotic SQLite construct
  parses into a shape my table/column collectors miss. That is exactly why the
  database access does not trust the validator — the readonly connection and the
  `statement.reader` assertion are there for the case where I am wrong about this.
- **Query cost under load.** There is no timeout, by choice. A pathological query
  is bounded by the row cap, but I have not measured what a handful of concurrent
  expensive scans does to latency.
- **The `NUMBER` regex in the verifier.** It works on everything I threw at it,
  but number extraction from free text is a long tail (ranges, "1.2M", ordinals).
  Its failure mode is fortunately the safe one: a number it fails to parse is
  simply not checked, and one it parses oddly causes a false rejection that
  degrades to a table.

Everything in the repo I can explain and change. The pieces I would be slowest on
are the AST collectors in `src/sql/validate.js`.

---

## 7b · Key decisions

**1. A hand-written semantic catalog instead of dumping the schema.**
*Alternatives:* full DDL in the prompt (the obvious choice); DDL plus sample rows;
auto-generated column descriptions.
*Why:* the model's failures on this dataset are not syntax failures, they are
*meaning* failures — summing `Invoice.Total` after joining `InvoiceLine`, treating
milliseconds as seconds, inner-joining a nullable `GenreId`. None of that is
recoverable from DDL, because DDL does not say what "revenue" means. Writing it
down once, by hand, fixes it for every question. The catalog then earns a second
and third job: it is the validator's allow-list, and its `absent_concepts` section
is what makes refusal principled rather than vibes. *Cost:* it is manual and must
be kept in sync — hence the load-time drift check.

**2. Middleware at the HTTP edge, a plain sequence in the pipeline.**
*Alternatives:* make the pipeline stages middleware too (I built that first); one
big handler; an event emitter.
*Why:* Express middleware genuinely earns its keep — request id, logging, rate
limit, validation and idempotency are independent concerns that compose in an
order you want to read off one line. The *pipeline* is not like that: it is a
fixed sequence with two early exits, and modelling it as a `(ctx, next)` chain
added a composer, a shared mutable context and an indirection for every stage
without buying anything. I deleted it and made `Engine.ask()` call its steps in
order. Same behaviour, one file instead of nine, and the control flow is visible
without holding a framework in your head. *Cost:* adding a stage means editing a
method rather than an array, which for six stages is not a real cost.

**3. Read-only by three independent mechanisms.**
*Alternatives:* trust the prompt; a DB user with SELECT-only grants; regex
filtering.
*Why:* untrusted input becomes executable code here, so I wanted layers that fail
differently. The AST gate is precise but depends on my understanding of the
parser. The `readonly` connection plus `query_only` is enforced by SQLite itself
and does not care what my parser thinks. The `statement.reader` assertion is
SQLite's own metadata about the compiled statement and does not care what the
connection flags say. `test/guardrails.test.js` verifies writes are blocked
*with the validator bypassed entirely*, which is the test that actually proves the
layering, and asserts the row count is unchanged afterwards. *Cost:* a validator
strict enough to occasionally reject exotic-but-valid SQL. A false rejection is a
repair attempt; a false acceptance is an incident.

**4. Resolve ambiguity by executing rival readings, not by asking a model.**
*Alternatives:* always ask when a question contains a fuzzy word; ask the model
"is this ambiguous?"; always answer with a stated assumption.
*Why:* "is this ambiguous" is unanswerable in the abstract — ambiguity only
matters if the readings give different answers. `"who is our best customer"`
happens to be genuinely load-bearing on Chinook (spend → Helena Holý, frequency →
Aaron Mitchell), but `"our biggest market"` by revenue and by customer count could
easily agree, and interrupting the user for that is a worse product. Running both
is cheap on this data and turns a judgement call into a measurement. It also makes
the clarifying question *better*: it arrives with each reading's answer attached.
*Cost:* N queries instead of 1, capped at 4 readings. On a warehouse I would gate
this on estimated query cost and fall back to asking.

**5. Idempotency in middleware, not in the engine.**
*Alternatives:* cache inside `Engine.ask()`; no cache; cache in the client.
*Why:* a repeated question costs a model call and a query for an answer that
cannot have changed, so it should be served from memory — and two *concurrent*
duplicates should collapse into one run, which is why the cache stores the
in-flight promise rather than only the finished response. Keeping it at the HTTP
edge means `Engine` stays stateless and, more importantly, the eval harness calls
`Engine` directly and is never served a cached answer. That matters: `eval:k3`
measures run-to-run consistency, and a cache in the engine would make that metric
trivially 100% — a number that can no longer fail. Errors are never cached, so a
transient Groq failure is not pinned for the whole TTL. *Cost:* in-memory only, so
it resets on restart and would need Redis behind more than one instance.

**6. Verify the answer against the rows, and reject it if it fails.**
*Alternatives:* prompt the narrator not to hallucinate and hope; show rows next to
prose and let the user check; skip the narrator and only render tables.
*Why:* "no fabricated numbers" is a requirement, and a requirement enforced only
by a prompt is a wish. Two mechanisms make it structural: the narrator is denied
the schema and the SQL (so it has nothing to answer *from* except the rows), and
every number it emits is traced back to the result set before shipping. A failure
degrades to a rendering of the rows — worse prose, still true. *Cost:* it verifies
numbers, not claims; see 7c.1.

---

## 7c · Design questions

### 1. Top ways this system can produce a wrong-but-confident-looking answer

**(a) A valid query that answers the wrong question.** This is the big one, and my
verification layer does *not* catch it. `SUM(Invoice.Total)` joined to
`InvoiceLine` returns a real number from real rows — provenance verification
passes, the prose is grounded, and the figure is ~10× too high. Every guard I have
is satisfied by a confidently wrong answer here.
*How I catch it:* the catalog's metric definitions and pitfalls remove the most
common instances at the source; `q14` in the benchmark exists specifically to
detect it, graded against gold SQL; and `test/grounding.test.js` asserts the
grader *fails* the buggy version, so the detector itself is tested.
*What I'd add next:* an automatic fan-out lint — if the AST joins a one-to-many
pair and then aggregates a column from the "one" side without `DISTINCT`, flag it.
That is a deterministic check for the single most common class of silently-wrong
analytics SQL, and it is maybe 40 lines against the AST I already have.

**(b) Silent scope loss.** `INNER JOIN` on a nullable FK (`Track.GenreId`,
`Track.AlbumId`) quietly drops rows, so "what share of tracks…" computes over a
subset while looking complete. The row cap does the same thing at the other end.
*How I catch it:* the pitfall is in the catalog; truncation is surfaced explicitly
in the answer and in the trace. *What I'd add:* run a `COUNT(*)` of the base table
alongside any ratio query and warn when the denominators disagree.

**(c) Ambiguity resolved silently, or an entity matched loosely.** `"best"`
answered on one arbitrary reading; `WHERE Name LIKE '%maiden%'` matching a
tribute-band album. The user cannot tell from the prose which reading they got.
*How I catch it:* the probe forces the divergence into the open, and every
assumption is a structured field surfaced in every interface. Entity matching is
only partly handled — exact match is used, but I do not verify that a filter
matched what the user meant.
*What I'd add:* echo filter cardinality back ("matched 1 artist named Iron
Maiden") so a zero-match or a 12-match filter is visible rather than implied.

The honest summary: I have strong guarantees on **safety** and on **prose-to-rows
grounding**, and only benchmark-level evidence on **query-to-intent correctness**.
I would rather say that plainly than imply the pipeline closes a gap it doesn't.

### 2. If the dataset were much larger than the model's context

**Retrieval over the catalog, which is already the seam.** Nothing downstream ever
sees the whole schema — `catalog.retrieve()` returns a scored subset and the
planner only ever gets that. Today the scoring is lexical, which is right for 11
tables and has the useful property of being deterministic. At 1,000 tables I would
replace that method body with a vector search over per-table and per-column
description embeddings, plus a join-graph expansion so retrieved tables arrive
with the FK paths that connect them, and I would not need to change the planner,
the validator or the executor at all.

Three things break at that scale beyond retrieval, and I would rank them:
column-level retrieval matters more than table-level (a 300-column fact table blows
the budget on its own); the catalog stops being hand-writable and needs generation
from DDL + profiling with human review of the metrics section only; and the
validator's allow-list can no longer be "everything in the catalog" but should be
scoped to the retrieved subset, which also usefully narrows the blast radius.

### 3. Bonus — the same question answered twice, differently

This is why `src/trace.js` exists. Each run writes a record containing an `id` — a
hash of everything that *should* determine the answer (question, rendered catalog
context, system prompt, model) — plus a `rowsDigest`, an order-insensitive hash of
the result set, and every SQL attempt with its rejection reason.

Pull both traces and diff, in this order:

1. **Trace ids differ** → an *input* changed, not the model. Someone edited the
   catalog, or retrieval picked different tables because the user phrased it
   differently. The diff shows which.
2. **Ids match, `rowsDigest` differs, SQL identical** → the *data* changed
   underneath. Not a bug in the system.
3. **Ids match, SQL differs** → genuine model non-determinism. Temperature is
   pinned to 0, so this points at provider-side variability or a model version
   change; the trace records the model string, so a silent upgrade shows up here.
4. **Everything matches but the prose differs** → the narrator varied. Harmless for
   facts, since the provenance check passed on both; still worth pinning.

`npm run eval:k3` runs the whole benchmark three times and reports a consistency
score with the unstable case ids named, so this class of bug is measured
continuously rather than discovered by a user complaint. It clears the idempotency
cache between passes, otherwise it would be grading its own cache.

---

## 7d · Code critique

```python
def answer_question(question: str) -> str:
    schema = get_full_schema()
    sql = llm(f"Schema: {schema}\nWrite SQL for: {question}")
    rows = db.execute(sql)
    return llm(f"Answer '{question}' using this data: {rows}")
```

**Trust**

1. **The final call can ignore `rows` entirely.** It is handed the question and
   some free-form data with no obligation to use either, so when the rows are
   confusing it will happily answer from parametric knowledge in fluent prose.
   This is the worst bug here because it is *invisible* — the wrong answers look
   exactly like the right ones. Fix: starve the narrator of everything except the
   rows, then verify every number it emits against them.

2. **`-> str` throws the evidence away.** No SQL, no rows, no confidence, no
   assumption. The signature makes the brief's core requirement — an answer the
   user can trust and audit — literally unimplementable. This is a design bug, not
   a style one: the return type should be a structured result carrying the query,
   the rows and a verdict.

3. **No concept of "I can't answer this."** Every question routes to SQL, so
   "what's our profit margin" produces a number derived from `UnitPrice` — a
   confident, well-formed, fabricated business metric. There is no path for
   clarify or refuse, so the system's failure mode is *always* to guess.

**Safety**

4. **`db.execute(sql)` runs whatever the model returns.** `DROP TABLE`, `DELETE`,
   stacked statements, `ATTACH`, `load_extension` — user text reaches the database
   as executable code with nothing in between. A prompt-injected string in a
   customer name is enough. Needs a read-only connection *and* a statement-level
   check *and* a parse-level gate.

   There is also no row cap, so the model's `LIMIT` habits become your cost model:
   whatever it happens to write is what runs.

5. **No row limit and no timeout.** One `SELECT * FROM InvoiceLine` or an
   accidental cross join pins the process and streams the table into the next
   prompt. Both a cost and an availability problem.

6. **Whole schema into the prompt, every call.** Leaks structure into a third
   party, costs tokens on every question, and stops working entirely at real scale.

**Correctness / engineering**

7. **The SQL is never parsed, so it is never checked.** Markdown fences alone will
   break `db.execute` in normal operation, and a hallucinated column surfaces as a
   database error rather than a repairable diagnosis.

8. **No error handling and no repair path.** Any bad SQL raises, and the user gets
   a stack trace instead of an answer or a second attempt.

9. **`rows` is interpolated as a raw repr** — no column names, no types, no
   truncation. The narrator has to infer what the tuples mean, which is the fastest
   route to a mislabelled number.

10. **Nothing is logged, so nothing is debuggable.** No SQL, no timing, no model
    version, no trace. The "why did it answer differently twice" question is
    unanswerable by construction.

11. **Untestable by design.** Everything is inline behind two module-level globals
    with no seams, so there is no way to test the safety behaviour without a live
    model and a live database.
