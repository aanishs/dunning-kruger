import { describe, it, expect } from "vitest";
import { makeAgentMatcher, parseVerdict, buildJudgePrompt } from "../src/grade/agent-matcher";
import { goldenCases, runEval, passesComprehensionContract } from "../../core/src/index";

describe("agent-matcher (key-free; shells to the user's own claude/codex)", () => {
  it("parses a JSON verdict embedded in tool output", () => {
    const r = parseVerdict('chatter {"score": 4, "covered": ["a"], "missed": ["b"], "learnNext": "x", "reason": "y"} more');
    expect(r.score).toBe(4);
    expect(r.covered).toEqual(["a"]);
    expect(r.missed).toEqual(["b"]);
  });

  it("clamps the score and rejects garbage output", () => {
    expect(parseVerdict('{"score": 9}').score).toBe(5);
    expect(() => parseVerdict("no json here")).toThrow();
    expect(() => parseVerdict('{"score": "abc"}')).toThrow();
  });

  it("builds a prompt that forbids keyword-stuffing and demands JSON", () => {
    const p = buildJudgePrompt("ans", { targetId: "t", type: "explain", prompt: "Q", expectedConcepts: ["calls foo"] });
    expect(p).toMatch(/keyword-stuffing/i);
    expect(p).toContain('"score"');
  });

  it("parses the per-facet dimensions and drops null/missing facets", () => {
    const r = parseVerdict(
      '{"score": 3, "dimensions": {"mechanism": 5, "failureModes": 1, "blastRadius": null, "rationale": 9}}',
    );
    expect(r.score).toBe(3);
    expect(r.dimensions).toEqual({ mechanism: 5, failureModes: 1, rationale: 5 }); // null dropped, 9 clamped to 5
  });

  it("rolls the overall up from the facets when no explicit overall is given", () => {
    // mechanism 5, failureModes 1, rationale 2 -> avg 2.67 -> 3
    const r = parseVerdict('{"dimensions": {"mechanism": 5, "failureModes": 1, "rationale": 2}}');
    expect(r.score).toBe(3);
  });

  it("stays valid when there are no dimensions (the keyword-style verdict)", () => {
    const r = parseVerdict('{"score": 4}');
    expect(r.score).toBe(4);
    expect(r.dimensions).toBeUndefined();
  });

  it("a correct semantic judge PASSES the contract the keyword matcher fails", async () => {
    // Simulate the session judge: it would read the code; here we encode the intended verdict
    // by recognising each golden answer inside the prompt. Stuffing/injection/empty score low,
    // real understanding (named or paraphrased) scores high.
    const semantic = makeAgentMatcher("/repo", (prompt) => {
      const p = prompt.toLowerCase();
      const score = p.includes("(no answer)")
        ? 0
        : p.includes("ignore your rubric")
          ? 1
          : p.includes("clamp formatmoney order string branch null edge case returns")
            ? 2
            : 5; // recall-good AND the identifier-free paraphrase both = real understanding
      return JSON.stringify({ score, covered: [], missed: [], learnNext: "", reason: "" });
    })!;
    expect(semantic).not.toBeNull();
    const results = await runEval(semantic);
    expect(passesComprehensionContract(results)).toBe(true);
    // and the cases the keyword matcher gets wrong, the semantic judge gets right:
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["gameability"].score).toBeLessThanOrEqual(2);
    expect(byId["paraphrase"].score).toBeGreaterThanOrEqual(4);
  });
});
