// keywordMatcher: the OFFLINE FALLBACK grader — NOT the comprehension grader.
//
// It checks which substrate-derived identifiers (callees / params / return / branches) appear
// in the answer. No LLM, no key, fully reproducible. Per ADR 0001 this is honestly a RECALL
// SMOKE-TEST, not a comprehension grade: it can be gamed by keyword-stuffing and cannot tell
// understanding from name-dropping. It exists for use OUTSIDE a Claude session. In skill mode
// the session model is the judge and grades semantically against the real code.

import { Matcher, Question, GradeResult } from "../types";

export const keywordMatcher: Matcher = {
  name: "keyword",
  grade(answer: string, question: Question): GradeResult {
    // No code-derived rubric (e.g. a graphify leaf symbol with no callees/params/branches): the
    // offline matcher genuinely can't grade this. Say so honestly instead of scoring 0 with a
    // contradictory "Solid" message — and point at the path that CAN grade it.
    if (question.expectedConcepts.length === 0) {
      return {
        score: 0,
        covered: [],
        missed: [],
        learnNext:
          "The offline grader has no code facts for this symbol — run with `--smart`, or the /dunning-kruger skill, for a real grade.",
        reason: "Not gradable by the offline keyword matcher: this substrate exposed no params/branches/callees to check against.",
      };
    }

    const hay = ` ${answer.toLowerCase()} `;
    const covered: string[] = [];
    const missed: string[] = [];

    for (const concept of question.expectedConcepts) {
      if (conceptCovered(concept, hay)) covered.push(concept);
      else missed.push(concept);
    }

    const total = question.expectedConcepts.length || 1;
    const score = Math.round((covered.length / total) * 5);
    const learnNext = missed.length
      ? `Go re-read the part where it ${humanize(missed[0])}.`
      : "Solid — you've got this one. Try a harder target next.";
    const reason = `Covered ${covered.length}/${total} of the concepts this function's code actually contains.`;

    return { score, covered, missed, learnNext, reason };
  },
};

function conceptCovered(concept: string, hay: string): boolean {
  // "calls X" — whole-word match so `id` doesn't get credited inside `grid`.
  let m = concept.match(/^calls (.+)$/i);
  if (m) return wordHit(hay, m[1]);
  // "parameter: X"
  m = concept.match(/^parameter: (.+)$/i);
  if (m) return wordHit(hay, m[1]);
  // "returns X" — require the actual return word/type, NOT the bare word "return" (which
  // would credit "I don't know what it returns").
  m = concept.match(/^returns (.+)$/i);
  if (m) return wordHit(hay, m[1]);
  // "handles N branch/edge case(s)" — credit any branch/edge vocabulary
  if (/branch|edge case/i.test(concept)) {
    return /\b(branch|edge|case|null|empty|undefined|guard|if |else|when |handle)/i.test(hay);
  }
  // fallback: literal substring
  return hay.includes(concept.toLowerCase());
}

function wordHit(hay: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9_])${escapeRe(t)}([^a-z0-9_]|$)`, "i").test(hay);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function humanize(concept: string): string {
  if (/^calls /i.test(concept)) return concept.replace(/^calls /i, "calls into ");
  if (/^parameter: /i.test(concept)) return `uses the \`${concept.replace(/^parameter: /i, "")}\` parameter`;
  if (/^returns /i.test(concept)) return `produces its return value`;
  if (/branch|edge/i.test(concept)) return `handles its edge cases / branches`;
  return concept;
}
