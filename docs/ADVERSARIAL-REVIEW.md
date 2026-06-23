# Adversarial review (Codex / gpt-5.5, 4 angles) — 2026-06-22

## Angle: 1-substrate

**Findings**

1. Critical: project references are ignored.
[ts-compiler.ts](../packages/core/src/substrate/ts-compiler.ts#L213) reads only the first `tsconfig.json`, then uses `parsed.fileNames`. A root solution tsconfig with only `references` has zero files, so this falls into the glob fallback at line 224 and loses every package's `baseUrl`, `paths`, `jsx`, `allowJs`, decorators, and module settings. On a real monorepo, cross-package alias edges become mostly missing.

2. Critical: fallback module resolution is not credible.
[ts-compiler.ts](../packages/core/src/substrate/ts-compiler.ts#L233) hardcodes `NodeNext`, `allowJs: false`, no `baseUrl`, no `paths`, no `jsx`, no package-specific config. Relative `.ts` imports work. Workspace imports like `@app/foo`, Vite aliases, Next aliases, TS path aliases, and package references usually do not. This silently produces a sparse graph, not a warning-worthy degraded graph.

3. Critical: overloads create wrong edges.
`collect` stores every function declaration, including overload signatures with no body, in `declToId` at [ts-compiler.ts:88](../packages/core/src/substrate/ts-compiler.ts#L88). `resolveCallee` returns the first matching declaration at [ts-compiler.ts:138](../packages/core/src/substrate/ts-compiler.ts#L138). For overloaded functions, calls can point at a bodyless overload signature instead of the implementation. That gives false in-degree, false target rank, and a dead symbol as ground truth.

4. Critical: the collected symbol universe is too narrow.
`asFunctionLike` only accepts named function declarations, identifier method declarations, and variable declarations initialized with arrows/functions at [ts-compiler.ts:101](../packages/core/src/substrate/ts-compiler.ts#L101). It misses constructors, class property arrows, anonymous default exports, computed/string-literal methods, most object property function values, inline callback symbols, JSX component calls, decorators, `new C()`, tagged templates, and many framework entry points. Those are normal real-world TypeScript, not edge cases.

5. High: higher-order calls are mostly invisible.
`arr.map(helper)`, `pipe(a, b)`, `router.get(path, handler)`, `useMutation(fn)`, callback props, DI containers, and function-valued params do not become call edges. `resolveCallee` only resolves the expression being invoked at [ts-compiler.ts:126](../packages/core/src/substrate/ts-compiler.ts#L126). Passing a function as a value is not modeled. This misses a large share of real application wiring.

6. High: class dispatch is misleading.
`this.foo()` may resolve to a declared method, but virtual dispatch, interface-typed services, abstract base methods, mocks, and DI-backed instances resolve to the static declaration or no declaration. Calls through `Service.save()` typed as an interface usually do not point to the implementation. This is a false sense of precision from `checker.getSymbolAtLocation`.

7. High: exports are wrong.
`isExported` only walks for an `export` modifier at [ts-compiler.ts:165](../packages/core/src/substrate/ts-compiler.ts#L165). It misses `export { foo }`, `export default foo`, barrel re-exports, and package API exports. It also marks private/protected methods inside an exported class as exported because it walks up to the exported parent. `pickTargets` then gives bad API-surface weight at [pickTargets.ts:15](../packages/core/src/pickTargets.ts#L15).

8. High: `.js` / `.jsx` support is accidental at best.
With a tsconfig and `allowJs`, some JS can enter the program. With fallback, `.js` and `.jsx` are completely excluded at [ts-compiler.ts:230](../packages/core/src/substrate/ts-compiler.ts#L230), and fallback explicitly sets `allowJs: false`. Mixed TS/JS repos lose JS call sites and JS callees.

9. Medium: `getAliasedSymbol` is not enough for barrels.
`getAliasedSymbol` at [ts-compiler.ts:131](../packages/core/src/substrate/ts-compiler.ts#L131) can resolve simple imports/re-exports when module resolution succeeds. It does not fix failed paths, solution tsconfigs, package exports mismatches, default-export indirection, local destructuring, or re-export-only API classification. Barrels work only in the easiest case.

10. Medium: IDs are unstable and collision-prone.
The supposed stable key is `file#name:line` in [types.ts:10](../packages/core/src/types.ts#L10), generated at [ts-compiler.ts:73](../packages/core/src/substrate/ts-compiler.ts#L73). Insert a line above and the ID changes. Put two same-named methods on one line, or generated/minified code, and `nodes.set` overwrites. Class context is absent, so `A.save` and `B.save` display as the same `save`; CLI lookup by name returns the first match at [cli.ts:139](../packages/cli/src/cli.ts#L139).

11. Medium: decorators are invisible.
Decorator expressions are outside `bodyOf`, and pass 2 only walks bodies at [ts-compiler.ts:41](../packages/core/src/substrate/ts-compiler.ts#L41). NestJS, TypeORM, Angular, MobX, validation decorators, DI decorators: missing. In those repos, decorators are often the real wiring.

12. Medium: crashes are possible and unreported diagnostics are ignored.
Invalid tsconfig errors from `readConfigFile` are not handled at [ts-compiler.ts:215](../packages/core/src/substrate/ts-compiler.ts#L215). Fallback `fs.readdirSync` has no error boundary at [ts-compiler.ts:226](../packages/core/src/substrate/ts-compiler.ts#L226). Compiler diagnostics are never surfaced, so unresolved imports quietly become missing edges.

**Expected Error Rate**

For a clean single-package TS repo with proper tsconfig and mostly direct functions: missed edges around 20-40%, false edges around 2-10%.

For a modern 5k-file repo with monorepo refs, path aliases, React/Next, services/classes, callbacks, barrels, and mixed JS: missed edges around 40-80%. Cross-package alias edges can be near 100% missing when the root tsconfig is references-only. False edges likely 5-20%, mostly overloads, abstract/interface dispatch, class method ambiguity, and exported-surface mistakes.

Yes, this quietly corrupts the grading ground truth. `generateQuestions` turns `target.callees` directly into expected concepts at [generateQuestions.ts:12](../packages/core/src/generateQuestions.ts#L12), and `pickTargets` ranks by bad in-degree/callee counts at [pickTargets.ts:14](../packages/core/src/pickTargets.ts#L14). The tool will confidently quiz users on incomplete or wrong dependency facts.

---

## Angle: 2-grading

**Verdict: fatal as written.**

The core claim does not survive this grader. It is reproducible, but reproducibly bad. It measures lexical overlap with generated identifiers, not comprehension.

**1. Gameability**

The grader gives credit for raw substring hits:

- Callees: answer contains callee name: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L36)
- Params: answer contains param name: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L39)
- Return: answer contains return type OR the word `return`: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L42)
- Branches: answer contains any of `branch`, `edge`, `case`, `null`, `empty`, `undefined`, `guard`, `if`, `else`, `when`, `handle`: [keyword-matcher.ts](../packages/core/src/grade/keyword-matcher.ts#L45)

A zero-understanding 5/5 answer:

```text
parseThing normalizeThing input options return if null else edge case
```

If the expected concepts are calls `parseThing`, calls `normalizeThing`, parameter `input`, parameter `options`, returns anything, handles branches, this gets full credit. It says nothing. It is keyword stuffing.

Worse: substring matching means accidental hits count. A param named `id` can be credited inside unrelated words. A return concept can be credited by “I don’t know what it returns.” Branch credit can be earned by saying “if else null empty” with no explanation.

**2. False Negatives**

A correct senior-level answer can score badly if it avoids implementation names:

```text
It first turns the raw input into a structured representation, then canonicalizes it before deciding whether the candidate satisfies the predicate. The optional settings object changes strictness. Missing input short-circuits through the defensive path, while malformed input is separated from valid-but-empty data.
```

That demonstrates actual understanding. But if it does not literally say the callee names, param names, return type string, or one of the branch magic words, it loses points.

This will be especially insulting for people who understand the code at the semantic level. The grader rewards parroting the source over explaining behavior.

**3. Deeper Problem**

The generated “ground truth” is not comprehension. It is just:

- callee names
- parameter names
- return type
- branch count bucket

That is built here: [generateQuestions.ts](../packages/core/src/generateQuestions.ts#L14)

This misses the important parts:

- why those callees are used
- what data transforms happen
- invariants
- ordering constraints
- side effects
- failure modes
- domain intent
- what would break if changed
- distinction between naming something and understanding it

A senior can bomb by explaining architecture without identifier recall. A memorizer can ace by dumping signatures. That is not a comprehension score.

**4. Positioning**

“Reproducible” survives. “Auditable” survives only in the trivial sense that you can audit the bad scoring rule. “FAIR” and “comprehension score” do not survive.

An LLM judge can rescue paraphrase handling only if the expected concepts become semantic claims. If it is forced to pass golden evals built around this same concept list, it inherits the wrong target. It becomes a nicer keyword matcher, not a validity fix.

Blunt version: this is defensible as an identifier-recall smoke test. It is not defensible as a serious auditable comprehension grader.

---

## Angle: 3-bugs

**Findings**

- `packages/cli/src/cli.ts:278`
  Quote: `else waiting.push(resolve);`
  `makeReader()` never handles `rl.close`/EOF. If piped input has fewer lines than prompts, the pending `ask()` promise is never resolved or rejected. Concrete failure: `printf '3\n' | dk interview <repo> 1` consumes the rating, asks Q1, then EOF leaves the interview unfinished with no diagnostic.

- `packages/cli/src/cli.ts:291`
  Quote: `.filter((x) => !Number.isNaN(x));`
  `parseRatings()` deletes invalid tokens, shifting later ratings onto the wrong targets. Concrete failure: `5,x,1` for three targets becomes `[5,1,3]`, so target 2 gets target 3’s rating.

- `packages/cli/src/cli.ts:296`
  Quote: `nums[i] ?? 3`
  Missing ratings silently become `3`. Concrete failure: entering `5` for five targets records four fabricated neutral self-ratings and corrupts the D-K gap.

- `packages/cli/src/cli.ts:236`
  Quote: `runs = JSON.parse(fs.readFileSync(file, "utf8"));`
  Corrupt or partial `overlay.json` is treated as empty history. Concrete failure: one interrupted write makes the next run discard all previous runs by writing `JSON.stringify([...[], run])`.

- `packages/cli/src/cli.ts:256`
  Quote: `fs.writeFileSync(file, JSON.stringify([...runs, run], null, 2));`
  Overlay persistence is read-modify-write with no lock and no atomic rename. Concrete failure: two concurrent interviews both read the same old array; the later writer overwrites the earlier run.

- `packages/cli/src/cli.ts:255`
  Quote: `fs.mkdirSync(dir, { recursive: true });`
  Running against a repo the user cannot write crashes after the interview instead of degrading to “no overlay saved.” Concrete failure: read-only target repo throws on `.dunning-kruger` creation/write and aborts before `printOverTime`/`printVerdict`.

- `packages/core/src/curve.ts:33`
  Quote: `return Math.max(1, Math.min(5, r));`
  The clamps do not handle `NaN`. Concrete failure: `placeOnCurve([{ selfRating: NaN, score: 5 }])` returns `selfPct: NaN`, `gap: NaN`, and the bogus zone `"Climbing out"`.

- `packages/core/src/grade/keyword-matcher.ts:40`
  Quote: `return hay.includes(m[1].toLowerCase());`
  Parameter matching is raw substring matching. Concrete failure: expected `parameter: id` is marked covered by an answer containing `grid`.

- `packages/core/src/grade/keyword-matcher.ts:43`
  Quote: `hay.includes("return")`
  Return concepts get credit for any mention of “return,” including wrong answers. Concrete failure: for `returns string`, the answer “I don’t know what it returns” is marked covered.

- `packages/cli/src/cli.ts:305`
  Quote: `main(process.argv.slice(2)).then((code) => process.exit(code));`
  `process.exit()` after async main can truncate stdout when output is piped. Concrete failure: large `questions`/`targets` output piped to another process exits before pending stdout writes drain.

---

## Angle: 4-product

Yes: in its current shape, it is a toy with a sharp demo.

The launch screenshot is obvious: “I rated myself 9/10, scored 4/10.” People will share that once because it is spicy. Then most will uninstall because the repeat loop is weak. Serious engineers do not wake up wanting a CLI to quiz them. They want help before a risky change, before on-call handoff, before reviewing an unfamiliar module, before deleting code, before merging AI-generated code. “Measure my Dunning-Kruger gap” is vanity/novelty. “Prove I understand this change well enough to own it” is closer to a habit.

The construct validity problem is fatal as written. Callees, params, returns, and branch counts measure local code recall, not understanding. A senior can understand the architecture, invariants, failure modes, and tradeoffs while not naming helper functions. A junior can skim signatures and score well. That makes the “competence” number fake precision. The tool is grading “can you recite the implementation shape,” then branding it as comprehension. Smart users will notice immediately.

The shaming problem is not fixed by “growth, not gotcha.” The product name, Mount Stupid framing, “you only cheat yourself,” “black boxes,” and confidence-vs-competence score all create a humiliation mechanic. OSS adoption depends on identity. Engineers share tools that make them look sharper, faster, more rigorous. They do not voluntarily install tools whose core artifact says “I was deluded about my own competence,” unless it is a meme. Meme installs churn.

The deterministic keyword grader undercuts the credibility claim. Determinism is not the same as intelligence. Literal matching makes the tool feel dumb exactly when the audience is sophisticated. If someone says “it clamps out-of-range input to configured bounds before formatting the total,” and the grader misses `clamp`, `formatMoney`, or parameter names, the user does not think “auditable.” They think “toy parser with a judgemental graph.”

The single adoption killer: the tool asks the user to perform work for an insult-adjacent payoff. Five self-ratings, five questions, then a score that may feel wrong. That is too much friction and too much ego threat for too little utility.

Better shape: stop being a personality test. Become a “code ownership verifier.”

The core loop should be:

1. Pick a PR, module, or incident-relevant path.
2. Ask scenario questions that test operational understanding: invariants, failure modes, data flow, side effects, security/privacy boundaries, rollback risk, test gaps.
3. Grade with evidence, but classify gaps as “ownership risks,” not personal competence.
4. Output something useful: reviewer checklist, handoff brief, missing tests, risky assumptions, “you are not ready to merge this because X.”
5. Track improvement per code area over time.

The standout OSS artifact is not “Dunning-Kruger curve for developers.” That is a gimmick.

The serious version is: “Before you ship AI-written code, this tool checks whether you actually understand the blast radius.” That has a real repeat loop, a real buyer/user pain, and a reason to run it every week.

---

