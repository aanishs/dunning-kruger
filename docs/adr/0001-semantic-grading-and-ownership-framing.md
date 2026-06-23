# ADR 0001 — Semantic, ownership-oriented grading; D-K hook + ownership engine

Status: Accepted (2026-06-22)
Driver: 4-angle Codex adversarial review (see ../ADVERSARIAL-REVIEW.md)

## Context

The v1 engine grades by extracting an identifier-level "expected concept set" (callees,
params, return type, branch count) from the call graph and substring-matching it against the
user's answer. Two independent review angles converged on a fatal flaw:

- It measures **identifier recall, not comprehension.** A keyword-stuffed answer
  (`"parseThing normalizeThing input options return if null else edge case"`) scores 5/5
  with zero understanding; a correct semantic paraphrase that avoids the literal identifiers
  scores low. "Defensible as a recall smoke-test, not as an auditable comprehension grader."
- The **Dunning-Kruger personality framing** risks being a one-screenshot gimmick with a weak
  repeat loop and a shaming mechanic that "growth, not gotcha" copy doesn't fully defuse.

The substrate review separately showed call-edge extraction degrades badly on real repos
(40-80% missed edges on a monorepo), so identifier lists are also an unreliable answer key.

## Decision

1. **Grade semantics, not identifiers.** Question generation asks SEMANTIC / ownership
   questions about the symbol — invariants, failure modes, "what breaks if `<param>` is
   null", rollback/blast-radius, test gaps. The semantic JUDGING is done by the session model
   (skill mode), which reads the real code and weighs understanding — there is no structured
   "expected-answer" artifact in the engine. The identifier-level concept set the engine does
   extract is ONLY the rubric for the deterministic keyword matcher, which is **demoted to an
   offline fallback** and reframed honestly as a recall smoke-test, not the comprehension
   grader.
   - The substrate's job shifts: it supplies the *material* to ask good blast-radius
     questions (callees, callers, branches, params), it is no longer the answer key.

2. **D-K hook for distribution, ownership engine for substance.** Marketing leads with the
   shareable Dunning-Kruger curve (the meme gets the install). The engine is built around
   **code-ownership / blast-radius** questions and outputs something useful — a reviewer
   checklist, a handoff brief, or "not ready to merge because X" — not just a personality
   score. This converges with the advisory merge-gate already scoped.

## Consequences

- **No raw API key, ever — the judge is an LLM the user already pays for.** In the
  chat / skill mode (the preferred path) the Claude Code session model IS the judge:
  semantic grading, zero key. A standalone `dk` CLI run outside a session does NOT take an
  API key; if it wants real grading it shells out to the user's own already-authenticated
  CLI — `claude -p` or `codex exec` (i.e. their subscription) — and otherwise falls back to
  the deterministic keyword matcher (a recall smoke-test). A bring-your-own Anthropic API
  key is explicitly out of scope.
- The **golden eval (T10) must test semantic grading** (gameability, paraphrase credit,
  injection), not identifier overlap — it inherits the new rubric, not the old one.
- Substrate accuracy matters less as an "answer key" but still drives question quality;
  hardening it (project refs, path aliases, HOFs, decorators) remains worthwhile but is no
  longer load-bearing for grade correctness.
- Supersedes the identifier-level grading rubric in the design doc
  (`sections/SCORING.md` and the design doc's "Grading rubric") for the LLM-judge path.

## Alternatives rejected
- Keep the keyword grader and market it honestly as a smoke-test: concedes the "taken
  seriously" positioning. Rejected (kept only as the fallback).
- Patch the substring exploits and defer: a patch, not an answer to recall-vs-comprehension.
