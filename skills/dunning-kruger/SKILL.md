---
name: dunning-kruger
description: >-
  Interviews you about your OWN codebase like a technical interview, scores you against the
  actual code with auditable receipts, and plots your Dunning-Kruger gap — what you THINK
  you understand vs what you actually do. Built for the AI-coding era: point it at a repo
  you vibe-coded and find out how much is a black box. Tone is growth, not gotcha. Use when
  the user says "dunning kruger", "quiz me on my code", "grill me on this repo", "test my
  comprehension", "how well do I understand my codebase", "am I cooked on this codebase", or
  for the ownership mode: "review my own PR", "am I ready to ship/merge this change", "do I
  understand this change", "what's the blast radius of this diff", "gut-check me before I ship".
---

# Dunning Kruger — interview yourself on your own code

Role reversal: every other tool explains code *to* you; this one makes you explain your
code *to it*, then scores you against what the code actually does. People who lean on AI
*feel* like they understand their code right up until they have to explain it — and the
skill that would tell you you don't is the same skill you skipped (Kruger & Dunning's "dual
burden"). This makes that gap measurable, then helps you close it. **Growth, not gotcha** —
and skip the "Mount Stupid" curve; it's an internet cartoon, not from the paper.

## Two modes

- **Skill mode — YOU are the brain (the smart path, the default).** You're running inside
  the user's Claude Code session, so **you do ALL the LLM work yourself — picking targets,
  asking the questions, judging the answers, teaching — on this session. No API key, no
  separate model, ever.** You grade comprehension semantically against the real code (judging
  mechanism, invariants, failure modes, blast radius — not parroted identifiers), per
  `sections/SCORING.md` (skill/agent mode). Optionally shell out to `dk targets <repo>` for a
  precise, deterministic call-graph (that's zero-LLM plumbing) — but the questions and the
  grading are always you. Use this by default.
- **CLI mode — the reproducible offline floor.** When the user wants a deterministic,
  repeatable score, or isn't in an agent session, run the `dk` CLI:
  ```
  dk interview <repo>     # self-rate → grilled → score → D-K curve → teach
  dk teach <repo> [sym]   # just the teaching loop on the weakest / a named symbol
  ```
  The CLI grades with a deterministic keyword matcher — honest as a *recall smoke-test*, not
  a comprehension grade. It **never uses an API key**; for real grading outside the chat it
  can shell out to the user's own `claude -p` / `codex exec` (their subscription), but the
  chat is the preferred path. Use the CLI when reproducibility matters more than judgment.

## Iron rules (both modes)

1. **Self-rating BEFORE any question.** The user predicts competence first; `gap = self −
   measured`. No self-prediction = a score, not a Dunning-Kruger placement.
2. **Grounding.** Every question and score ties to code you have read. Quote `file:line`.
   If you didn't read it, you can't grade it.
3. **Auditable receipts, not vibes.** Each score ships the evidence (`file:line`), what the
   answer covered, and what it missed — enough that the user can argue with the score.
4. **Growth, not gotcha (binding).** BANNED: "failed", "fraud", "you don't actually
   understand", "(bad)". REQUIRED: name the one concept to learn next on every weak score.
5. **Don't reveal the answer before they try; don't let vague answers off the hook.** A low
   score with a clear receipt is the product working.
6. **No peeking** — remind them once to answer from memory.

## Step 0 — read the room (pick the mode)

Figure out WHY they invoked you from context; don't make them spell it out.

- Check for a **change in flight**: `git status --porcelain` (uncommitted edits) and
  `git rev-list --count <base>..HEAD` where `<base>` is the default branch (a branch ahead of
  base), and whether a PR is checked out. If there is one, they're probably about to ship —
  offer **ownership mode**: *"You've got a change in flight (N files / branch ahead of main).
  Want me to check you understand THIS change before you ship, or interview you on the whole
  repo?"*
- If the tree is **clean**, default to **calibration mode** — the full-repo interview + curve.
- If they explicitly said "review my PR / am I ready to ship / blast radius," go straight to
  ownership.

Announce the mode you picked in one line and let them switch. Then route:
**calibration → the loop below; ownership → `sections/OWNERSHIP.md`.** Same judge and same
receipts either way — only the question set differs (whole repo vs. just the change).

## Calibration mode — the loop

0. **Setup** — confirm the repo; load `.dunning-kruger/overlay.json` if present (for the
   over-time view).
1. **Pick 5 targets** — recently-changed, central (many callers), exported, or complex.
   Read each in full so questions and scoring are grounded.
2. **Self-rate** — show the 5 targets; capture a 1-5 rating for each before any question.
3. **Interview** — one code-grounded question per target at the chosen altitude (see *Question
   altitude* below — default: interview-style, not line-by-line), one at a time, wait for answers.
4. **Score** — 0-5 with a receipt. See `sections/SCORING.md`.
5. **Placement** — self% vs measured%, gap, zone. See `sections/CURVE.md`.
6. **Persist + teach** — append the run to `.dunning-kruger/overlay.json`; offer the
   teaching loop on the weakest target. See `sections/TEACHING.md`.

## Question altitude — interview, don't quiz

Pitch every question at the level of a **technical interview about decisions**, not a quiz about
syntax: *"why did you reach for a queue here instead of a direct call?"* — never *"what does line
42 do?"* Three altitudes (the CLI mirrors them as `--level=high|mid|low`):

- **high — design rationale.** Why is it shaped this way; what alternative was rejected; what does
  this buy; where does it stop scaling. The most diagnostic altitude — understanding *why* is what
  separates the author from a reader.
- **mid — behavior & blast radius (default).** What it guarantees, what breaks downstream if it
  changes, the failure paths. Where calibration lives.
- **low — mechanism.** Walk the exact control flow, every branch, the specific edge cases.

Default to **mid, leaning high** — that's the interview feel. Announce the altitude in one line and
let the user redial anytime (*"go deeper" / "stay high-level"*); in ownership mode, skew to blast-radius.

**Include at least one counterfactual — "why X and not Y?"** This is the single sharpest ownership
signal, and it's the one thing the CLI *can't* do well: the CLI asks "what alternative did you pass
on" generically, but **you understand the domain, so name the REAL alternative** they rejected —
*"why DynamoDB and not Postgres for this table?"*, *"why a new endpoint instead of extending the
existing one?"*, *"why poll instead of a webhook?"* A confident answer is the strongest proof of real
ownership; a blank stare is the most useful gap. **Guardrail:** if the decision genuinely had a forced
hand (only one viable option), say so and move on — don't manufacture a fake fork to score someone on.

## A second job: ownership

The loop above is *calibration* — how well do you know this repo. There's a second, more
durable use: **ownership** — you're about to ship or hand off a change (often AI-written) and
need to know if you understand its blast radius well enough to own it. Same primitive (read
real code → grade comprehension → receipt), different scope (the diff + its callers/callees)
and different output (a ship-readiness checklist, not a curve). When the user's intent is
"am I ready to ship this," run `sections/OWNERSHIP.md` instead of the calibration loop.

## Section index — read each when its step applies

| When | Read |
|------|------|
| scoring an answer (semantic in skill mode; the receipt) | `sections/SCORING.md` |
| rendering the curve + naming the calibration zone (honest labels, no meme) | `sections/CURVE.md` |
| the teaching loop (explain → explain-back → re-score, the protégé effect) | `sections/TEACHING.md` |
| reviewing a change/PR for ship-readiness (blast radius, ownership) | `sections/OWNERSHIP.md` |

---
_The "interview you about your own code" idea is part of the comprehension-debt response to
AI-assisted coding; the skill format and one-question-at-a-time discipline follow the grill
family in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT)._
