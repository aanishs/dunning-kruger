// generateQuestions: turn a target symbol into an ownership / blast-radius interview question.
//
// It also extracts an identifier-level concept set (callees, params, return, branches) from
// the code. IMPORTANT (per ADR 0001): that set is NOT the answer key. It is only the rubric
// for the deterministic offline keyword fallback (a recall smoke-test). In skill mode the
// session model judges comprehension SEMANTICALLY against the real code — the concept set
// does not constrain it.

import { SymbolGraph, SymbolNode, Question } from "./types";

export function generateQuestions(target: SymbolNode, graph: SymbolGraph): Question[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const calleeNames = target.callees.map((id) => byId.get(id)?.name ?? stripId(id));

  const expectedConcepts: string[] = [];
  for (const c of calleeNames) expectedConcepts.push(`calls ${c}`);
  for (const p of target.params) expectedConcepts.push(`parameter: ${p}`);
  if (target.returnType) expectedConcepts.push(`returns ${target.returnType}`);
  if (target.branchCount > 0) {
    expectedConcepts.push(
      `handles ${target.branchCount} branch/edge case${target.branchCount > 1 ? "s" : ""}`,
    );
  }

  // Ownership / blast-radius questions, not "name the callees". The expectedConcepts above
  // stay identifier-level (the CLI keyword fallback grades against them); in skill mode the
  // agent judges the answer semantically against the real code regardless of phrasing.
  // v1 ships one question per target (5 targets = the 5-question interview).
  const callerNames = graph.nodes.filter((n) => n.callees.includes(target.id)).map((n) => n.name);
  const where = `(${target.file}:${target.line})`;

  let prompt: string;
  let type: Question["type"];
  if (callerNames.length >= 1) {
    type = "trace-call"; // blast-radius
    const who = callerNames.slice(0, 3).join(", ");
    prompt =
      `\`${target.name}\` is called by ${who}. If you changed what it returns or how it ` +
      `behaves, what downstream breaks — and what does it lean on to do its job? ${where}`;
  } else if (target.branchCount > 0 && target.params.length > 0) {
    type = "null-param"; // failure mode
    prompt =
      `What breaks inside \`${target.name}\` if \`${target.params[0]}\` is null / empty / ` +
      `unexpected? Walk the failure path, not the happy path. ${where}`;
  } else {
    type = "explain"; // invariant
    prompt = `What does \`${target.name}\` guarantee, and what would silently break if that guarantee were wrong? ${where}`;
  }

  return [{ targetId: target.id, type, prompt, expectedConcepts }];
}

function stripId(id: string): string {
  const hash = id.indexOf("#");
  const colon = id.lastIndexOf(":");
  return hash >= 0 && colon > hash ? id.slice(hash + 1, colon) : id;
}
