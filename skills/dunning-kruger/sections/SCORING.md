# SCORING — grade comprehension, not recall

There are two graders. The mode picks which one.

## Skill / agent mode (PRIMARY — YOU are the judge)

You're running inside a Claude Code session, so you ARE the LLM judge. No API key, no
keyword matching, no separate model. Judge the answer the way a sharp senior reviewer would,
against the real code you read in step 1.

**Grade comprehension, not identifier recall.** A correct paraphrase that never names the
helper functions can still be a 5; naming every callee while missing what the function
guarantees is not a 5. Judge whether the answer actually demonstrates:

- **Mechanism** — what it does, in order.
- **Invariants** — what it guarantees / assumes.
- **Failure modes** — what breaks if a param is null / empty / unexpected.
- **Blast radius** — what else breaks if you change it (use the callers + callees from the
  graph: "summarize calls this, so changing the return breaks the summary line").
- **The why** — where it's inferable from the code.

Then emit 0-5 + a receipt grounded in `file:line`:

```
<symbol> (file:line)
  you rated N/5 · measured M/5
  ✓ understood: <the real things the answer got right>
  → gap: <the specific thing missed — an invariant, a failure mode, a caller it affects>
  next: <the one thing to go read>
```

Hard rules (these are exactly the failure modes an adversarial review flagged):

- **Do NOT reward keyword-stuffing.** A list of identifiers with no explanation is a 1, not
  a 5. "parseThing normalizeThing input options return null edge case" understands nothing.
- **Do NOT punish a correct explanation for avoiding the literal function names.** Behavior
  described correctly counts, even with zero identifiers.
- **Be reproducible.** Same answer → same grade. Apply the same bar every time.
- Growth, not gotcha. Never "you failed." Always name the next thing to read.

## CLI / no-agent mode (the offline FALLBACK)

The `dk` CLI runs OUTSIDE an agent, so it can't reason — it uses the deterministic keyword
matcher (substring overlap with callees / params / branches). Label it honestly: it's a
**recall smoke-test**, not a comprehension grade. It's the reproducible floor for people who
aren't in a Claude session. If a standalone CLI user wants real grading without an API key,
it can shell out to their OWN `claude -p` or `codex exec` (their subscription) — but the
preferred path is just to run this in the chat. A raw API key is never used.
