# Round-3 Codex review — 2026-06-22

**Findings**

1. `packages/core/src/substrate/ts-compiler.ts:169` still misses real exports. `isExported()` only detects `export` modifiers on the declaration/parents. `function foo() {}; export { foo }` and `const foo = () => {}; export { foo }` are indexed as non-exported, so target ranking underweights public API.

2. `packages/core/src/substrate/ts-compiler.ts:101` misses anonymous default exports entirely. `export default function () {}` has no `node.name`, so it is not indexed at all. Same practical hole for default-exported function expressions not stored in a variable.

3. `packages/core/src/substrate/ts-compiler.ts:169` over-marks private/protected methods as exported. Any method inside `export class X` inherits the class export, so `private helper()` becomes `exported: true`, inflating non-public implementation details.

4. `packages/core/test/engine.test.ts:95` does not cover the export cases that matter. It only proves nested locals are not exported and `export function outer` is exported. No tests for `export { foo }`, `export default`, re-exported classes, or private methods of exported classes.

5. `packages/cli/src/parse.ts:11` still accepts malformed ratings. `parseInt("5x", 10)` returns `5`, so an invalid slot does not default to `3` despite `packages/cli/test/parse.test.ts:8` claiming invalid entries default.

6. `packages/cli/src/cli.ts:150` updates only `row.measured` after teaching. It does not update `row.missed`, `last.overall.measuredPct`, `last.overall.gap`, or `last.overall.zone`. Future curve/over-time output can show a higher target score with stale missed concepts and stale overall calibration.

7. `packages/cli/src/cli.ts:308` treats non-array JSON as empty history and overwrites it without backup. The corrupt-overlay backup only catches parse failures at `packages/cli/src/cli.ts:310`; `{}` is semantically corrupt for this schema but silently destroyed.

8. `packages/core/src/eval/golden.ts:87` is not a robust semantic gate. It only checks five fixed answer strings and score bands. A hard-coded or shallow matcher can pass it; it does not assert citations, reasoning, prompt-injection resistance beyond one string, or consistency across equivalent paraphrases.

9. `package.json:12` is broken now. `npm run typecheck` runs `tsc -b`, but there is no root `tsconfig.json`; it fails with `TS5083: Cannot read file .../tsconfig.json`.

**Doc Contradictions**

- `docs/adr/0001-semantic-grading-and-ownership-framing.md:24` says question generation produces semantic expected-answer claims. Actual `packages/core/src/generateQuestions.ts:15` still emits identifier concepts: callees, params, return type, branch count.
- `skills/dunning-kruger/sections/TEACHING.md:24` says “answer key.” ADR says identifier lists are no longer the answer key at `docs/adr/0001-semantic-grading-and-ownership-framing.md:30`.
- `skills/dunning-kruger/sections/TEACHING.md:10` and `packages/core/src/teach.ts:3` say teaching uses the same facts grading used. In skill mode, grading is supposed to be semantic, not the substrate fact list.
- `packages/core/src/index.ts:6` through `packages/core/src/index.ts:9` still marks already-exported/current features as `[next]`, and still says overlay is SQLite while the implementation is JSON in `packages/cli/src/cli.ts:295`.

**Most Important Missing Thing**

No actual semantic grader exists in code. The project now documents that keyword matching is not comprehension, and the golden eval proves the fallback is bad, but there is no implemented session-model judge, no semantic expected-answer artifact, and no real CI gate for comprehension quality. That is the credibility gap. Tests also could not run in this read-only sandbox because Vitest needs temp/cache writes.
