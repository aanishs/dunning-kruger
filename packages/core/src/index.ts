// @dunning-kruger/core — public engine surface.
//
//   [built]  indexRepo / pickTargets        — rented substrate -> SymbolGraph (call edges) + ranking
//   [built]  generateQuestions              — ownership/blast-radius prompts + identifier rubric (fallback)
//   [built]  keywordMatcher                 — the OFFLINE recall fallback (not the comprehension grader)
//   [built]  placeOnCurve / renderCurveHtml — calibration + the shareable HTML artifact
//   [built]  buildLesson                    — the teaching loop
//   [built]  golden eval                    — the comprehension CONTRACT the semantic grader must pass
//   semantic grader                — the chat session model (preferred), or a standalone CLI
//                                    shelling to `claude -p` / `codex exec` (the user's sub).
//                                    NEVER a raw API key. Not a programmatic Matcher in core.
//   [TODO]   SQLite overlay                 — productized store (today: JSON, written by the CLI)

export * from "./types";
export { indexRepo } from "./substrate/ts-compiler";
export { pickTargets } from "./pickTargets";
export { generateQuestions } from "./generateQuestions";
export { keywordMatcher } from "./grade/keyword-matcher";
export { placeOnCurve } from "./curve";
export { buildLesson } from "./teach";

export { goldenCases, runEval, passesComprehensionContract } from "./eval/golden";
export { renderCurveHtml } from "./render/curve-html";
export type { CurveData, CurvePoint } from "./render/curve-html";
