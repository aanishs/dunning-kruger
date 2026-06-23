// pickTargets: rank symbols by how worth-interviewing-on they are.
//
// Heuristic, not sacred (the user can override). v1 weights: exported (it's the API
// surface), centrality (lots of callers = load-bearing), branch count (complex = easy to
// misunderstand), and size. Trivial symbols (tiny, no callers, not exported, no branches)
// are filtered out so we don't waste a question on a one-liner.

import { SymbolGraph, Target } from "./types";

export function pickTargets(graph: SymbolGraph, n = 5): Target[] {
  const ranked: Target[] = graph.nodes
    .map((node) => {
      const inDegree = graph.inDegree[node.id] ?? 0;
      const rank =
        (node.exported ? 3 : 0) +
        inDegree * 2 +
        node.branchCount * 1.5 +
        Math.min(node.loc / 10, 4) +
        node.callees.length * 0.5;
      return { ...node, inDegree, rank };
    })
    .filter((t) => !isTrivial(t))
    .sort((a, b) => b.rank - a.rank);

  return ranked.slice(0, n);
}

function isTrivial(t: Target): boolean {
  return t.inDegree === 0 && t.callees.length === 0 && !t.exported && t.branchCount === 0 && t.loc < 4;
}
