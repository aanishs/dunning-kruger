import { describe, it, expect } from "vitest";
import { keywordMatcher } from "../src/grade/keyword-matcher";
import { goldenCases, runEval, passesComprehensionContract } from "../src/eval/golden";

describe("T10 semantic golden eval — the comprehension contract", () => {
  it("defines the bar a real grader must clear", () => {
    const byId = Object.fromEntries(goldenCases.map((c) => [c.id, c]));
    expect(byId["gameability"].comprehension.max).toBeLessThanOrEqual(2); // stuffing must lose
    expect(byId["paraphrase"].comprehension.min).toBeGreaterThanOrEqual(4); // paraphrase must win
    expect(byId["injection"].comprehension.max).toBeLessThanOrEqual(1); // injection must lose
  });

  it("proves the keyword matcher is a RECALL smoke-test, not a comprehension grader", async () => {
    const results = await runEval(keywordMatcher);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));

    // it does its recall job: a real, concept-naming answer scores high
    expect(byId["recall-good"].score).toBeGreaterThanOrEqual(4);

    // the two documented flaws — exactly why it's only the offline fallback:
    expect(byId["gameability"].score).toBeGreaterThanOrEqual(4); // keyword-stuffing fools it
    // a meaningless keyword dump beats a correct, identifier-free explanation:
    expect(byId["paraphrase"].score).toBeLessThan(byId["gameability"].score);

    // therefore it CANNOT pass the comprehension contract (the semantic grader must):
    expect(passesComprehensionContract(results)).toBe(false);
  });

  it("injection and empty answers score low even on the keyword matcher", async () => {
    const byId = Object.fromEntries((await runEval(keywordMatcher)).map((r) => [r.id, r]));
    expect(byId["injection"].score).toBeLessThanOrEqual(1);
    expect(byId["empty"].score).toBe(0);
  });
});
