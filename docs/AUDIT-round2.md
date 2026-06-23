# Round-2 audit (build vs plans) — 2026-06-22

## Codex (cross-model) — conformance + correctness + skill-decomposition

**1. Conformance Matrix**

| Component | Status | Evidence |
|---|---:|---|
| Substrate | PARTIAL / DRIFTED | Built TS compiler adapter only. No `tree-sitter`, `scip-typescript`, LSP race, Joern, project-ref support. `tsconfig` with no files falls to crude glob: [ts-compiler.ts](../packages/core/src/substrate/ts-compiler.ts#L217). |
| `pickTargets` | PARTIAL | Uses exported, in-degree, branch count, LOC, callee count. No git churn, no cyclomatic, weak override story: [pickTargets.ts](../packages/core/src/pickTargets.ts#L14). |
| `generateQuestions` | DRIFTED | Prompts are ownership-ish, but expected concepts are still identifier/shape recall: `calls`, `parameter`, `returns`, branches: [generateQuestions.ts](../packages/core/src/generateQuestions.ts#L14). ADR wanted semantic claims. |
| Grading / Matcher | DRIFTED | Matcher interface exists, only keyword matcher implemented. No `llmJudge`, no hybrid, no prompt hash, no semantic eval. Keyword matcher remains substring overlap: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L34). |
| Curve | PARTIAL | Core `placeOnCurve` exists with formulas and guards. CLI renders ASCII only. No HTML/SVG shareable artifact: [curve.ts](../packages/core/src/curve.ts#L12), [cli.ts](../packages/cli/src/cli.ts#L201). |
| Overlay / persistence | PARTIAL / DRIFTED | JSON overlay in CLI only. No core overlay module, no SQLite, no migration. Temp+rename exists: [cli.ts](../packages/cli/src/cli.ts#L232). |
| Teaching loop | PARTIAL | `teach` exists, but teaches substrate facts and regrades with keyword matcher. It does not update overlay after explain-back despite docs saying it should: [cli.ts](../packages/cli/src/cli.ts#L150), [TEACHING.md](../skills/dunning-kruger/sections/TEACHING.md#L37). |
| CLI commands | PARTIAL | Built: `index`, `targets`, `questions`, `interview`, `teach`. Missing planned `curve --html`, `weak`, `gate`: [cli.ts](../packages/cli/src/cli.ts#L37). |
| Skill | PARTIAL | Skill correctly says session model is the judge and no key is needed: [SKILL.md](../skills/dunning-kruger/SKILL.md#L21). But it still bundles three workflows and references expected-concept extraction: [SKILL.md](../skills/dunning-kruger/SKILL.md#L69). |
| Golden eval T10 | MISSING | Only unit tests over fixture and keyword matcher. No semantic golden/stability/injection eval: [engine.test.ts](../packages/core/test/engine.test.ts#L39). |
| Merge-gate Action T15 | MISSING | No `packages/action`, no `action.yml`. |
| Benchmark T16/T17 | MISSING | No `packages/benchmark`, no `SPEC.md`, no harness. |
| Shareable HTML curve T12 | MISSING | CLI prints ASCII curve only: [cli.ts](../packages/cli/src/cli.ts#L201). |
| SQLite overlay T8 | MISSING | JSON overlay only; comment admits SQLite is future: [cli.ts](../packages/cli/src/cli.ts#L225). |
| Decay T9 | MISSING | No `decay`, Leitner, SM-2, or scheduling implementation. |
| npm publish + CI T18 | PARTIAL / MISSING | Workspaces exist, but no CI workflow, no changesets, no build script, root is private. CLI bin points to nonexistent `dist/cli.js`: [packages/cli/package.json](../packages/cli/package.json#L6). |
| Multi-language | MISSING | TypeScript-only. Fallback excludes JS/JSX: [ts-compiler.ts](../packages/core/src/substrate/ts-compiler.ts#L230). |

**2. Correctness Bugs**

Claimed fixes:

- `parseRatings` positional parse: PARTIAL. `5,x,1` no longer shifts; invalid token becomes neutral `3`: [cli.ts](../packages/cli/src/cli.ts#L306). But empty comma slots still shift because `/[,\s]+/` collapses separators. `5,,1` becomes tokens `["5","1"]`, so target 2 gets target 3’s rating. Missing ratings still silently become `3`: [cli.ts](../packages/cli/src/cli.ts#L313).
- `makeReader` EOF guard: FIXED for no-hang. Close resolves pending asks with `""`: [cli.ts](../packages/cli/src/cli.ts#L286). Still no diagnostic; short piped input fabricates empty answers and may continue through prompts.
- Atomic overlay write: PARTIAL. Temp+rename prevents truncated target file: [cli.ts](../packages/cli/src/cli.ts#L259). It is not concurrency-safe: fixed temp path plus read-modify-write can lose runs or fail rename under two concurrent interviews.
- Curve NaN guards: FIXED in core. `Number.isFinite` clamps invalid self/score to floor: [curve.ts](../packages/core/src/curve.ts#L33).
- `process.exitCode` instead of `process.exit`: FIXED. Uses natural drain: [cli.ts](../packages/cli/src/cli.ts#L323).

Other concrete bugs:

- Corrupt overlay still discards history. Parse failure resets `runs = []`, then next successful write overwrites old history: [cli.ts](../packages/cli/src/cli.ts#L237).
- Keyword matcher still credits substring junk. `parameter: id` matches `grid`: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L39).
- Return scoring is still bogus. “I don’t know what it returns” earns return credit because it contains `return`: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L41).
- Substrate IDs are line-based and collision-prone despite being documented as stable: [types.ts](../packages/core/src/types.ts#L10), generated at [ts-compiler.ts](../packages/core/src/substrate/ts-compiler.ts#L72).
- README claims target picking includes “recently changed”; code has no git churn input: [README.md](../README.md#L16), [pickTargets.ts](../packages/core/src/pickTargets.ts#L14).

**3. Contradictions**

- ADR says grade semantic claims, substrate is not the answer key. Code still says expected concept set is “ground truth” and derives it from callees/params/returns/branches: [generateQuestions.ts](../packages/core/src/generateQuestions.ts#L1).
- ADR demotes keyword matcher to offline fallback. Core comments call it “the deterministic default” and “credibility floor”: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L1).
- Skill mostly follows ADR: session model is judge, no key, semantic grading: [SCORING.md](../skills/dunning-kruger/sections/SCORING.md#L5). README contradicts that by marketing code-extracted callees/params/returns/branches as trusted grading ground truth: [README.md](../README.md#L46).
- CEO plan bans “fraud”; README uses it: [README.md](../README.md#L12).
- “Growth, not gotcha” conflicts with CLI copy: “you only cheat yourself,” “Peak of Mount Stupid,” “what the code says you know,” “black boxes”: [cli.ts](../packages/cli/src/cli.ts#L107), [cli.ts](../packages/cli/src/cli.ts#L204), [cli.ts](../packages/cli/src/cli.ts#L211), [cli.ts](../packages/cli/src/cli.ts#L218).
- Phase 2 says Phase 1 skill converges to thin CLI wrapper. Actual skill is smarter than CLI; CLI is the recall fallback. Converging it downward would violate the ADR.

**4. Biggest Risk**

The product still lacks a valid comprehension grader in the engine. The only executable grader is the exact identifier-recall matcher the ADR declared fatal. The skill instructions moved toward the ADR, but the productized code, README, tests, and CLI are still mostly pre-ADR.

So: the build is converging in the skill text, drifting in the engine. Shippable credibility depends on replacing executable keyword grading with semantic ownership grading plus evals. Without that, this is a polished recall quiz wearing a comprehension label.

**5. Skill Decomposition**

Split it into three skills.

- `dunning-kruger`: self-rate, interview, curve. Keep the viral hook here. One-session calibration artifact only.
- `teach-back` or `code-tutor`: explain → explain-back → re-score. Different user intent: learning a module, not measuring confidence gap.
- `ownership-gate` or `ship-readiness`: PR/change comprehension gate. Output reviewer checklist, blast-radius risks, handoff brief, “not ready because X.” This is the serious repeat-use product.

Do not keep all three bundled. The workflows have different triggers, success metrics, and emotional posture. Comparable skills split when the job changes: `grill-me` vs `grill-with-docs`, and the CEO/eng/design review family. `office-hours` can keep two modes because both are ideation interviews. Here, calibration, tutoring, and ship-readiness are separate jobs.

Splitting does not fragment the D-K hook. It sharpens it. Let `dunning-kruger` be the memorable entry point, then route weak-score users into `teach-back` and PR users into `ownership-gate`. The ownership skill should become the durable habit; the D-K curve is the acquisition mechanic.

---
## Adversarial Workflow (6 Claude agents) — synthesis

I'll review the findings and produce the consolidated verdict.

# Dunning-Kruger Build Audit — Lead Reviewer Verdict

## 1. Top Correctness Bugs (by severity, deduped, file:line)

| Sev | Bug | Location |
|-----|-----|----------|
| **HIGH** | Overloaded fn/method signatures create phantom bodiless `SymbolNode`s. Resolved callee returns the FIRST decl (a signature), not the impl → edge lands on the wrong line, impl loses centrality, phantom gets ranked as a target. Verified live (`foo(1)` → decls [2,3,4] hasBody [F,F,T], edge→line 2). | `packages/core/src/substrate/ts-compiler.ts:74-88,101-107,138-147` |
| **HIGH** | `isExported` over-broad: walks to SourceFile, returns true on ANY ancestor `ExportKeyword`. Nested locals (`inner`/`innerFn`) inside an exported fn report exported:true → inflates rank (+3), mis-frames API-surface copy, lets phantom signatures dodge `isTrivial`. Verified live. | `ts-compiler.ts:165-174` (consumers `pickTargets.ts:16,29`) |
| **MED** | Module/file scoping uses non-separator-aware `startsWith(root)` → sibling dir `/repo/app-shared` matches root `/repo/app`. Pulls foreign files into the program. Verified. | `ts-compiler.ts:32,214` |
| **MED** | Persist read-modify-write race + shared `overlay.json.tmp` path. Under the documented concurrent-tabs reality, two `dk interview` runs both write the same tmp; last rename wins, one run silently lost, half-written tmp can be renamed by the other process. Atomic temp+rename only fixes single-process crash. | `packages/cli/src/cli.ts:232-266` (tmp at :259) |
| **MED** | Exported phantom overload signatures survive `isTrivial` (fails the `!exported` clause) and get picked as interview targets → degenerate question about a bodiless signature. (Same root cause as bug #1.) | `ts-compiler.ts:39-41,74-88`; `pickTargets.ts:28-30` |
| **LOW** | `cmdTeach` numeric-name false-negative: name branch gated on `isNaN(parseInt(name))`, so `f1`/`v2` (`parseInt`=1) skip name lookup → silently teaches top-ranked target. Use `/^\d+$/`. | `cli.ts:138-142` |
| **LOW** | `keywordMatcher` "returns" concept credited by bare substring `hay.includes("return")`; "it returns something and handles the case" covers return+branch. Recall-gaming. Tolerable only because demoted — but it's still the de-facto grader in every CLI path. | `grade/keyword-matcher.ts:43,45-46` |

**Single highest-leverage code fix:** drop bodiless overload signatures at node-creation in `asFunctionLike`/`collect` — it kills the phantom-target bug, the wrong-edge-endpoint bug, and the `isTrivial`-escape bug in one change.

## 2. Top Plan-Drift / Missing Pieces

The build is a **Phase-1 proof, not the phase2.md monorepo.** What the plans promised and is NOT built:

- **T10 golden eval — THE keystone — does not exist.** No `eval/` dir, no golden corpus, no stability/injection/gameability test. Both the plan ("blocks merge") and ADR ("must test semantic grading") make this the credibility backstop. Absent.
- **T5 llm-judge Matcher — the PRIMARY grader — has zero code.** Only `keywordMatcher` exists in core+cli. `index.ts` still lists `Matcher` as `[next]`.
- **T8 SQLite overlay (the named "owned moat" / "only thing built net-new") drifted to JSON.** Append-array `.dunning-kruger/overlay.json`, no schema, no migration.
- **T12 shareable HTML/SVG curve — THE distribution artifact ("the number you screenshot") — missing.** Output is ASCII-to-stdout only. No html/svg writer anywhere.
- **ADR Decision #2 ownership/blast-radius engine essentially unbuilt.** "Reviewer checklist / handoff brief / not-ready-to-merge-because-X" appears nowhere in the skill tree; only as one of five grading bullets. This is the half of the ADR that defuses the "gimmick" risk.
- **Substrate drifted from the named rented stack** (tree-sitter + scip-typescript + multilspy spike-race + Joern) → raw `ts.createProgram` only. Defensible post-ADR (substrate no longer the answer key), but the committed multi-resolver spike never happened; multi-language absent; `.js/.jsx` hard-excluded.
- **Genuinely not-started (correctly P2 but nothing scaffolded):** T9 decay, T14 `dk gate`, T15 Action, T16/T17 benchmark+SPEC.md (the strategic centerpiece), T18 CI+changesets publish. `dk weak` and `dk curve --html` commands missing.
- **Test coverage is happy-path smoke only:** 98 lines, 4-symbol toy fixture with tsconfig present. The entire 334-line CLI (carrying 10 numbered Codex bug fixes) has ZERO tests. No NaN/∞/0/6/negative cases despite explicit guards. `generateQuestions` and `buildLesson` branches untested. The green suite gives false confidence about the exact thing (40-80% edge-miss on real repos) the ADR says is weak.

## 3. Contradictions (plans/ADR vs build)

- **`generateQuestions.ts:1-6` directly contradicts ADR-0001.** Header still asserts "The concept set is the ground truth; the LLM only judges whether the answer covered each concept." ADR Decision #1 says the opposite — semantic LLM judge primary, concept set "no longer the answer key." **This is the load-bearing keystone comment and it still encodes the demoted model.**
- **`README.md:48-49` still sells the demoted identifier-recall grader as the grader:** "tied to ground truth… callees, parameters, return shape, control-flow branches — never an LLM's gut feel." That is exactly the framing the ADR reversed, shipped to the skeptical-senior audience the whole project targets. **Cheapest high-sev fix; actively misrepresents the product while wrong.**
- **`expectedConcepts` is still identifier-level** (`calls X` / `parameter: Y` / `returns T`), contradicting ADR's mandate that question-gen produce semantic claims (invariants/failure-modes/blast-radius) as the rubric. The semantic path is **prose-only** — no structured rubric exists for the skill judge to grade against.
- **`engine.test.ts:39-63` asserts identifier-recall as correct behavior** ("covered ⊆ expectedConcepts"), which the ADR supersedes. The keyword-stuffing exploit the ADR calls fatal ("parseThing normalizeThing input options return…" = 5/5) is still scored 5/5 and never tested against.
- **Stale plans:** `design.md:200-218` and `phase2.md` T4/T5/T6 still specify the demoted "LLM-judge constrained to the fixed concept set." Anyone executing phase2 from the plan rebuilds the demoted model. (Low — ADR post-dates them, but they're un-annotated.)
- **`phase2.md` T19 / `design.md:184-189` "thin wrapper / skill→CLI convergence" is now stale and dangerous:** per ADR the skill OWNS the session-judge path. A contributor "converging" the skill to shell out to `dk` would delete the session-as-judge logic the ADR makes load-bearing.

**Honestly clean (no contradiction):** the SKILL surface. `keyword-matcher.ts` header, SKILL.md, SCORING.md, CURVE.md all correctly reflect the demotion; session-as-judge/no-key is propagated consistently; curve normalization + NaN guards + endLine/loc math are correct; the four claimed CLI fixes (positional ratings, EOF guard, atomic write, `exitCode`) are all verified correct.

## 4. One Skill or Several

**ONE skill.** Do not split into interview/teach/ownership skills.

- All three modes share the **same load-bearing primitive**: read real code → grade comprehension semantically → file:line receipt. SCORING.md is already reused verbatim by TEACHING.md. Splitting duplicates the rubric and invites drift.
- The **D-K curve is the single shareable hero artifact** and the entire distribution thesis. A standalone tutor or PR-gate severed from the curve loses the meme that drives installs — splitting fragments the hook.
- The `grill-me` / `grill-with-docs` split is **not** a valid precedent: those differ by a *side effect* (mutating CONTEXT.md/ADRs), not by audience or artifact. Here all modes feed the same overlay and the same curve.

**Recommended topology:** ONE `dunning-kruger` skill, three phrasing-selected modes — `interview+curve` / `teach` / **`ownership`** — over two run-locations (skill = session-judge primary; CLI = deterministic offline floor). The real defect is **under-building, not over-bundling:** add the missing ownership mode (new `sections/OWNERSHIP.md` → reviewer-checklist / handoff-brief / "not ready to merge because X", a section-index row, and frontmatter triggers like "do I understand this change well enough to ship", "blast radius of this diff", "review my own PR"). Then fix the stale "thin wrapper" language in phase2.md T19 / design.md so no one guts the session-judge logic.

## 5. Overall Verdict

**The SKILL is converging on the plans + ADR; the ENGINE/CLI and all of Phase-2 are drifting hard behind both.** The pivot is honored where users read prose (SKILL.md/sections) and contradicted where it counts as the contract — the README, the `generateQuestions` keystone comment, the test suite, and the actual code seam, where every executable grading path is still the identifier-recall matcher the ADR called "fatal as written." The "semantic grading" claim is currently **documentation-only.** The product's two graders are split badly: the *reproducible* one is the demoted smoke-test, and the *credible* one is an un-evaled skill prompt — and the resolver for that tension (T10 golden eval) is the single most important thing in every plan and it does not exist.

**Single most important next action:** **Build the T10 semantic golden eval (keyword-stuffed answer must score low; identifier-free paraphrase must score high; one prompt-injection case) and wire it into CI as a blocking gate — and in the same change rewrite the README:48-49 and `generateQuestions.ts:1-6` contradictions to match the ADR.** Until that lands, do not claim ADR conformance: the credibility backstop the entire "taken seriously" positioning rests on is unverified, and the public-facing docs still describe the grader the ADR reversed.
