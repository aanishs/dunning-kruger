# OWNERSHIP — "do you understand this change well enough to ship it?"

A different job from the calibration interview. Here the user is about to ship, hand off, or
own a change — often AI-written — and the real question is whether they understand its blast
radius well enough to be responsible for it. The output is something useful (a reviewer
checklist, a "not ready because X", a handoff note), not a personality score.

## When to run this
The user says "review my own PR", "am I ready to merge this", "do I understand this change",
"what's the blast radius of this diff", or "I vibe-coded this, gut-check me before I ship."

## Scope to the change, not the whole repo
1. Get the diff: `git diff <base>...HEAD` (or a named branch / PR / path). The targets are the
   symbols the diff **touches**, plus their **callers** (who breaks if this is wrong) and
   **callees** (what it leans on). `dk targets` ranks within the changed files if you want it.
2. Read the changed code AND its blast radius — callers and callees — for real, not the diff
   in isolation.

## Interview for OWNERSHIP, not recall
One question per changed symbol, aimed at shipping risk:
- What does this change guarantee that the old code didn't (or stops guaranteeing)?
- What breaks downstream if it's subtly wrong? Name the callers.
- What's the failure mode under bad input, partial failure, or concurrency?
- What did you *not* test that you'd want green before shipping?

Grade per `sections/SCORING.md` (semantic — you're the judge in a session). A confident
"looks fine" with no blast-radius answer is a fail, gently.

## Output an artifact they can use (not a curve)
- **Ship-readiness:** ready / not ready, one line of why.
- **Blast-radius checklist:** each caller/path this change can break, with a check to run.
- **Gaps to close before merge:** the specific things they couldn't explain + what to read.
- **Handoff note (optional):** 3–5 lines another engineer could read to take this over.

Frame every gap as an **ownership risk**, not a personal failing.

## Advisory by default
This is a mirror, not a gate. It tells the user where they're not ready; it never blocks a
merge unless they explicitly wire it as a CI gate — and that gate is a separate, opt-in
surface, not this skill.
