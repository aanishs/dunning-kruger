# TEACHING — closing the gap (the protégé effect)

After a weak score, don't just report it — help them learn it, then make them teach it back.
The act of explaining it back is what moves comprehension (the protégé / generation effect).

Run this on the weakest target (or a symbol the user names):

## 1. Explain it against the real code

Show the actual source span of the symbol, then a code-grounded breakdown of what it does —
its callees, parameters, branches, and what it returns — so "what you should know" is
concrete and lines up with where they fell short:

```
Here's what `<symbol>` actually does:   (file:line)
  <the real source lines>

What the code contains:
  • Parameters: <params>
  • Calls into: <callees, or "nothing — it's a leaf">
  • Branches / edge cases: <n>
  • Returns: <type>
```

Keep it factual and short. You're handing them the relevant facts to learn from, not lecturing.

## 2. Explain-back (no looking)

> Now, without looking — explain what `<symbol>` does in your own words.

Wait for it. This is the load-bearing step: retrieval + generation is where the learning
happens, not the reading.

## 3. Re-score and show the climb

Grade the explain-back with the same SCORING rubric. Then:

- improved → "You went 1/5 → 4/5. That's the climb — you just learned it." Update the
  overlay so the over-time view reflects it.
- same → "Same as before — give the branches another read, you're close." (no shame)
- lower → "Lower this pass — happens when you stop guessing and actually engage. One more."

Always end with what's left to nail, or "you covered all of it — nailed it." Never "you
failed." The whole point is to make the gap feel like a staircase, not a verdict.
