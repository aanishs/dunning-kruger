// buildLesson: the teaching half (protege effect). After a weak score, we EXPLAIN the
// symbol against the real code, then have the user explain it back. The explanation is
// grounded in the same substrate facts the grading used — so "what you should have known"
// lines up exactly with "what you missed". No LLM needed.
//
// Pure: takes the source text as input (the CLI does the file read). The explain-back is
// graded with the same Matcher, so improvement is measured on the same scale.

import { SymbolGraph, SymbolNode, Lesson } from "./types";

export function buildLesson(target: SymbolNode, graph: SymbolGraph, source: string): Lesson {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const calleeNames = target.callees.map((id) => byId.get(id)?.name ?? id);

  const breakdown: string[] = [];
  breakdown.push(`Parameters: ${target.params.length ? target.params.join(", ") : "none"}`);
  breakdown.push(
    calleeNames.length
      ? `Calls into: ${calleeNames.join(", ")}`
      : "Calls into: nothing else in this repo (it's a leaf function)",
  );
  breakdown.push(
    target.branchCount > 0
      ? `Branches / edge cases to account for: ${target.branchCount}`
      : "No branches — it runs straight through, no edge cases",
  );
  if (target.returnType) breakdown.push(`Returns: ${target.returnType}`);

  return {
    targetId: target.id,
    name: target.name,
    location: `${target.file}:${target.line}`,
    source,
    breakdown,
    explainBackPrompt: `Now, without looking — explain what \`${target.name}\` does in your own words:`,
  };
}
