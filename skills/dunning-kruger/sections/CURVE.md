# CURVE — the placement (two honest numbers, not a cartoon)

Turn (self-rating, measured score) pairs into a calibration reading.

## Math (use these exact formulas — the scales have different floors)

```
self%     = (selfRating - 1) / 4 * 100     # 1-5 scale, floor at 1
measured% = score / 5 * 100                # 0-5 scale, floor at 0
gap       = self% - measured%              # positive = overconfident
```

Compute per-target, then the session point = (mean measured%, mean self%).

## Don't draw "Mount Stupid"

The famous single-peaked confidence curve is **not in Kruger & Dunning's paper** — it's a
later internet cartoon, and engineers know it. Don't render it. Show the two numbers and the
gap, plainly:

```
confidence (what you felt):   <self%>
competence (what you showed): <measured%>
gap: <+/-N>%  ·  <zone>
```

## Zones (honest descriptions, not the meme)

| Condition | Zone |
|-----------|------|
| gap ≥ 25 and measured% < 55 | confidence ran ahead of competence |
| measured% < 40 and gap < 15 | low, and you know it |
| gap ≤ 12 and measured% ≥ 70 | calibrated and competent |
| measured% ≥ 50 | climbing, gap closing |
| else | finding your level |

## Honesty rules

- **n=1 is a single calibration point, not a curve.** Say so. The trajectory is the real
  artifact: run it again as you learn and watch the gap close.
- **Over time:** if a prior run exists in `.dunning-kruger/overlay.json`, show the delta
  ("last run measured 41% → now 58%").
- **The verdict:** say plainly whether ≥2 targets came in under the user's own rating. Frame
  it as a reading list, never a verdict on them. A big positive gap is the *useful* result —
  it's where the learning is — not a knock.
