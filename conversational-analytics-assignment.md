# Take-Home Assignment: "Talk to Your Data" — A Conversational Analytics Service

**Estimated time:** About 1 day of focused work. **Please don't spend more than ~8 hours.**
If you run out of time, ship what you have and write down what you would do next.
We care more about depth, judgment, and honesty than about a long feature list.

---

## 1. Context

We build a product where non-technical users ask questions about their business
data in plain English and get trustworthy answers — for example:

> "What was our revenue by country last year?"
> "Who are our top 10 customers?"

Under the hood this means turning a natural-language question into a **real query
against real data**, running it safely, and returning an answer the user can trust.

This assignment is a small, self-contained version of that problem. It is
deliberately open-ended: part of what we're evaluating is the decisions you make
when nobody hands you a spec.

---

## 2. The Task

Build a small service that lets a user ask natural-language questions about a
relational dataset and returns a **grounded, accurate answer** — backed by the
actual query and data used to produce it.

At minimum, a user should be able to send a question (via HTTP endpoint, CLI, or
simple UI — your choice) and receive:

1. A natural-language answer.
2. The **evidence** behind it: the query that was run and the raw result rows.
3. A clear, honest response when the question is **ambiguous** or **cannot be
   answered from the data** (see §4) — instead of a confident guess.

You may use any language, framework, database, and LLM/provider you like. You may
use a hosted LLM API or a local model. Keep setup simple enough for us to run.

---

## 3. Dataset

Use the **Chinook** sample database (a small digital-music store: customers,
invoices, tracks, albums, artists, genres, employees, etc.). It's freely
available for SQLite, PostgreSQL, MySQL, and others.

- It has ~11 related tables — enough to require joins and real reasoning.
- Get it from any of the public mirrors (e.g. search "Chinook sample database").
- SQLite is the lowest-friction option and is completely fine.

If Chinook is genuinely unavailable to you, you may substitute another relational
dataset with **at least 4 related tables**, but you must adapt the benchmark in §6
and note the change. Do not use a single flat CSV — the joins matter.

---

## 4. Functional Requirements (must-have)

- [ ] Accept a natural-language question and return an answer grounded in the data.
- [ ] Translate the question into a **validated** query, execute it, and use the
      **actual returned rows** to form the answer (no fabricated numbers).
- [ ] Return the underlying query and result rows alongside the answer.
- [ ] Handle **ambiguous** questions without silently guessing (ask a clarifying
      question, or answer and clearly state the assumption you made).
- [ ] Handle **unanswerable** questions (data isn't there) by saying so, rather
      than inventing an answer.
- [ ] Include a short **README** with setup and run instructions we can follow.

## 5. Guardrails & Safety (must-have)

Because the system turns untrusted input into executable queries, safety is part
of the core task, not an afterthought:

- [ ] Queries must be **read-only**. A question must not be able to cause a write,
      update, delete, or schema change. (This is the one hard requirement here.)
- [ ] Don't blindly execute model output — do a basic sanity check on what runs.
- [ ] Add a simple guard against runaway queries (e.g. a row limit). Timeouts and
      prompt-size handling are nice-to-have, not required.

---

## 6. Evaluation Harness (must-have — read carefully)

A demo that "looks like it works" on a couple of questions is not enough. We want
evidence that your system actually works, and an honest picture of where it fails.

**Build a small evaluation harness** that runs a labeled set of questions and
reports how many your system answers correctly.

Requirements:

1. Assemble a benchmark of **at least 12 questions** with expected answers/behavior.
   Twelve seed questions are provided below; just add 2–3 of your own.
2. Your benchmark **must include at least 1 ambiguous** question and **at least 1
   unanswerable** question (examples #9–#11 are already in the seed set). The
   "correct" behavior for those is to clarify or to decline — not to produce a number.
3. Your harness should run all questions and print a **score / accuracy summary**,
   plus which questions failed.
4. Briefly describe how you decide whether an answer is "correct" (exact match,
   numeric tolerance, a quick human check, etc.). A couple of sentences is enough.

### Seed questions (add a couple of your own)

| # | Question | Category |
|---|----------|----------|
| 1 | How many customers are there? | Simple lookup |
| 2 | List the 5 longest tracks by duration, with their names. | Sort + limit |
| 3 | What is total sales revenue by country? | Group + aggregate |
| 4 | Which genre generated the most revenue? | Join + aggregate |
| 5 | Which sales support employee generated the most revenue, and how much? | Multi-join |
| 6 | What is the average invoice total for customers in the USA? | Filter + aggregate |
| 7 | How many albums does the artist "Iron Maiden" have? | Join (easy to get subtly wrong) |
| 8 | What share of tracks are longer than 5 minutes? | Filter + ratio |
| 9 | Who is our best customer? | **Ambiguous** (best by what?) |
| 10 | What is the profit margin on each album? | **Unanswerable** (no cost data) |
| 11 | How many tracks were streamed last month? | **Unanswerable** (no streaming/date-usage data) |
| 12 | Which country has the most customers? | Group + sort |

You only need to add **2–3 of your own** — the ambiguous and unanswerable cases
(#9–#11) are already provided, so you don't have to invent those.

---

## 7. Written Component (must-have)

Include a short document (Markdown is fine) with the following. **Bullet points and
plain language are welcome — we're not grading prose, we're grading thinking.**

### 7a. AI usage log
- Which AI tools you used and for what (scaffolding, debugging, writing tests, etc.).
- One or two examples where AI gave you something you **rejected or had to fix**,
  and why.
- Anything in your final submission you would **not** be comfortable explaining or
  changing on the spot. (Honesty here counts in your favor.)

### 7b. Key decisions (3–5)
For each: what you decided, what alternatives you considered, and why. We're
especially interested in:
- How you translate a question into a query and keep answers grounded.
- How you keep it safe/read-only.
- How you handle ambiguity and unanswerable questions.

### 7c. Design questions (answer briefly)
1. What are the top 2–3 ways your system can produce a **wrong but confident-looking
   answer**, and how would you catch them?
2. If the dataset were much larger — too big to hand the whole schema/data to the
   model — name one thing you'd change. A short answer is fine.

_Optional bonus:_ if a user asked the same question twice and got two different
answers, how would you debug it?

### 7d. Code critique
The snippet below is a "first draft" someone might vibe-code in five minutes.
**List the ways it's flawed** (aim for 3+), covering correctness, safety, and
trust. You don't need to rewrite it.

```python
def answer_question(question: str) -> str:
    schema = get_full_schema()                       # entire schema as text
    sql = llm(f"Schema: {schema}\nWrite SQL for: {question}")
    rows = db.execute(sql)                            # run whatever the model returns
    return llm(f"Answer '{question}' using this data: {rows}")
```

---

## 8. Deliverables

- [ ] Source code in a git repository (public repo link or a zip with `.git` history).
- [ ] README: how to set up, load the data, run the service, and run the eval harness.
- [ ] The evaluation harness + its output (committed results are fine).
- [ ] The written component from §7.
- [ ] A few **screenshots or a short (~2 min) recording** showing it working —
      include one ambiguous and one unanswerable question.

Commit as you go — we like seeing history, not one giant final commit.

---

## 9. What We're Evaluating

To be transparent, here's what we optimize for:

- **Judgment & domain understanding** — do you understand *why* this problem is hard
  (grounding, ambiguity, trust, safety), not just how to call an API?
- **Correctness you can prove** — the eval harness and honest failure analysis.
- **Safety** — you treated untrusted-input-to-query as a real risk.
- **Efficient, honest AI use** — you moved fast with AI *and* understand your output.
- **Engineering fundamentals** — clear structure, sensible tests, readable code.

Explicitly **not** graded: fancy UI, model choice, number of features, prose polish.

---

## 10. Ground Rules on AI Use

**Using AI tools is encouraged — we want to see you use them well.** But:

- You own every line you submit. In a follow-up conversation we'll ask you to
  explain design choices and make a small live change to your own code.
- "The AI wrote it and I'm not sure how it works" is a worse answer than a smaller,
  simpler solution you fully understand.
- The AI usage log (§7a) must be honest. We're evaluating your judgment about *when*
  and *how* to use AI, not pretending you didn't.

---

## 11. Optional Stretch Goals (only if you have time)

Do **not** sacrifice the must-haves for these:

- A minimal chat UI.
- Multi-turn conversations (follow-up questions that reference prior context).
- Charts for results where appropriate.
- A confidence signal, or letting the user see/inspect the query before it runs.
- Cost/latency tracking or basic observability.

---

## 12. Submitting

Send us the repo link (or zip), the recording/screenshots, and your written
component. If anything is broken or unfinished, just tell us — a clear note about
what's incomplete is much better than a surprise.

Good luck, and have fun with it.
