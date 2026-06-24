// Core data model for the comprehension engine.
//
// The SymbolGraph is the RENTED code-structure layer (built here via the TypeScript
// compiler API). The comprehension overlay (per-user scores) is a separate concern that
// keys off SymbolNode.id — it is NOT in this file.

export type SymbolKind = "function" | "method" | "arrow";

export interface SymbolNode {
  /** Stable id: `<relfile>#<name>:<line>`. Survives across runs as long as the symbol exists. */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Repo-relative path. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** 1-based last line of the declaration (for pulling the source span). */
  endLine: number;
  exported: boolean;
  /** Parameter names (grading ground truth: "what breaks if <param> is null"). */
  params: string[];
  returnType?: string;
  /** Control-flow branch count: if / ternary / case / catch / && / || (grading ground truth). */
  branchCount: number;
  /** Intra-repo symbol ids this node calls (the derived call edges). */
  callees: string[];
  /** Lines of code in the declaration. */
  loc: number;
}

export interface SymbolGraph {
  /** Absolute repo root that was indexed. */
  repo: string;
  nodes: SymbolNode[];
  /** id -> number of intra-repo callers (centrality). */
  inDegree: Record<string, number>;
  /** Non-fatal notes (e.g. "no tsconfig found, used file glob"). */
  notes: string[];
  /**
   * Whether the substrate carries per-symbol BODY facts (params, branchCount, return type, exact
   * span). True/undefined for the TS-compiler substrate; false for graphify (call graph only) —
   * so `branchCount: 0` means "unknown", not "zero". Consumers phrase those facts honestly.
   */
  bodyFacts?: boolean;
}

export interface Target extends SymbolNode {
  /** Ranking score from pickTargets (higher = more worth interviewing on). */
  rank: number;
  inDegree: number;
}

export type QuestionType = "explain" | "null-param" | "trace-call";

/**
 * Question altitude — how high-level vs. low-level the interview probes.
 *   high → design rationale & tradeoffs ("why this shape, what did you reject?") — technical-interview altitude
 *   mid  → behavior / blast-radius / failure modes (the default)
 *   low  → line-level mechanism ("walk the exact control flow")
 */
export type Level = "high" | "mid" | "low";

export interface Question {
  targetId: string;
  type: QuestionType;
  prompt: string;
  /**
   * Identifier-level facts pulled from the code (param names, callee names, branch counts).
   * The keyword fallback scores literal coverage of these; the semantic judge treats them as
   * HINTS only and never requires the literal words. NOT a comprehension answer key — see ADR 0001.
   */
  expectedConcepts: string[];
}

/**
 * The facets of understanding a comprehensive grade breaks out (vs. one flat scalar).
 * These ARE the question altitudes: mechanism = low, failureModes/blastRadius = mid,
 * rationale = high. A single question won't probe all four; absent facets are just unscored.
 */
export type Dimension = "mechanism" | "failureModes" | "blastRadius" | "rationale";

export interface GradeResult {
  /** Overall 0-5 — the holistic roll-up the curve, buckets, and overlay all read. */
  score: number;
  /**
   * Per-facet 0-5 breakdown from the SEMANTIC judge (skill / `--smart`). Omitted by the keyword
   * fallback (it grades recall, not facets). A facet the question didn't call for is left out
   * rather than scored 0 — so the breakdown never penalizes a dimension nobody asked about.
   */
  dimensions?: Partial<Record<Dimension, number>>;
  covered: string[];
  missed: string[];
  /** Growth-not-gotcha: the one thing to learn next (never "you failed"). */
  learnNext: string;
  reason: string;
}

/**
 * Swappable grader. `keyword` is the deterministic default (no LLM, reproducible). An
 * `llm-judge` implementation drops in behind the same interface for nuance — both must
 * pass the same golden eval, so the score stays auditable.
 */
export interface Matcher {
  readonly name: string;
  grade(answer: string, question: Question): GradeResult | Promise<GradeResult>;
}

export interface TargetResult {
  /** Self-rating captured BEFORE the question, 1-5. */
  selfRating: number;
  /** Measured score, 0-5. */
  score: number;
}

export interface CurvePlacement {
  selfPct: number;
  measuredPct: number;
  /** self% − measured%. Positive = overconfident (the Dunning-Kruger gap). */
  gap: number;
  zone: string;
}

export interface Lesson {
  targetId: string;
  name: string;
  /** file:line */
  location: string;
  /** the actual source span of the symbol. */
  source: string;
  /** code-grounded facts (params, calls, branches, return) — what a real understanding covers. */
  breakdown: string[];
  explainBackPrompt: string;
}
