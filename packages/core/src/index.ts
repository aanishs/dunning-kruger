// @dunning-kruger/core — public engine surface.
//
//   [built]  indexRepo / pickTargets        — TS-compiler substrate -> SymbolGraph + ranking (the
//                                              INTERVIEW substrate: carries params/branches/spans)
//   [built]  indexRepoViaGraphify           — OPTIONAL polyglot substrate: projects graphify's
//                                              graph.json onto SymbolGraph (call graph only, no body
//                                              facts — see the adapter header). Not the CLI default.
//   [built]  generateQuestions              — ownership/blast-radius prompts + identifier rubric (fallback)
//   [built]  keywordMatcher                 — the OFFLINE recall fallback (not the comprehension grader)
//   [built]  placeOnCurve / renderReportMarkdown — calibration + the shareable markdown report
//   [built]  overlayComprehension           — paint a graphify Obsidian vault by comprehension
//   [built]  buildLesson                    — the teaching loop
//   [built]  golden eval                    — the comprehension CONTRACT the semantic grader must pass
//   semantic grader                — the chat session model (preferred), or a standalone CLI
//                                    shelling to `claude -p` / `codex exec` (the user's sub).
//                                    NEVER a raw API key. Not a programmatic Matcher in core.
//   [TODO]   SQLite overlay                 — productized store (today: JSON, written by the CLI)

export * from "./types";
export { indexRepo } from "./substrate/ts-compiler";
export { indexRepoViaGraphify, llmFreeEnv } from "./substrate/graphify";
export type { GraphifyOptions } from "./substrate/graphify";
export { pickTargets } from "./pickTargets";
export { generateQuestions } from "./generateQuestions";
export { keywordMatcher } from "./grade/keyword-matcher";
export { placeOnCurve } from "./curve";
export { buildLesson } from "./teach";

export { goldenCases, runEval, passesComprehensionContract } from "./eval/golden";
export { renderReportMarkdown } from "./render/curve-md";
export type { ReportData, ReportPoint } from "./render/curve-md";
export { overlayComprehension, joinKey } from "./render/comprehension-overlay";
export type { SymbolScore, OverlayOptions, OverlayResult } from "./render/comprehension-overlay";
export { renameDomains } from "./render/domains";
export type { RenameResult } from "./render/domains";
