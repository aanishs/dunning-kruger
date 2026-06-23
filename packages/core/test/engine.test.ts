import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { indexRepo } from "../src/substrate/ts-compiler";
import { pickTargets } from "../src/pickTargets";
import { generateQuestions } from "../src/generateQuestions";
import { keywordMatcher } from "../src/grade/keyword-matcher";
import { placeOnCurve } from "../src/curve";
import { buildLesson } from "../src/teach";
import { renderReportMarkdown } from "../src/render/curve-md";
import { overlayComprehension, joinKey } from "../src/render/comprehension-overlay";
import type { Question } from "../src/types";

const FIX = path.join(__dirname, "fixture");
const FIX_MONO = path.join(__dirname, "fixture-mono");

describe("substrate (TS-compiler)", () => {
  const g = indexRepo(FIX);

  it("finds the function-like symbols", () => {
    const names = g.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["clamp", "formatMoney", "priceOrder", "summarize"]);
  });

  it("derives accurate intra-repo call edges", () => {
    const priceOrder = g.nodes.find((n) => n.name === "priceOrder")!;
    const calleeNames = priceOrder.callees.map((id) => g.nodes.find((n) => n.id === id)!.name).sort();
    expect(calleeNames).toEqual(["clamp", "formatMoney"]);
    const summarize = g.nodes.find((n) => n.name === "summarize")!;
    expect(summarize.callees.map((id) => g.nodes.find((n) => n.id === id)!.name)).toEqual(["priceOrder"]);
  });

  it("counts branches and params from the real code", () => {
    const clamp = g.nodes.find((n) => n.name === "clamp")!;
    expect(clamp.params).toEqual(["x", "lo", "hi"]);
    expect(clamp.branchCount).toBe(2); // two if-statements
  });

  it("ranks the most central/complex symbol first", () => {
    expect(pickTargets(g, 5)[0].name).toBe("priceOrder");
  });
});

describe("substrate — monorepo project references (cross-package alias edges)", () => {
  const g = indexRepo(FIX_MONO);
  const fromA = g.nodes.find((n) => n.name === "fromA");
  const fromB = g.nodes.find((n) => n.name === "fromB");

  it("indexes both referenced packages from a references-only root", () => {
    expect(fromA).toBeTruthy();
    expect(fromB).toBeTruthy();
  });

  it("resolves a cross-package import that goes through a tsconfig path alias", () => {
    // The glob-only fallback (no paths/baseUrl) would miss this; following the project
    // references resolves `@b/*` -> pkg-b, so the fromA -> fromB edge survives.
    expect(fromA!.callees).toContain(fromB!.id);
    expect(g.inDegree[fromB!.id]).toBe(1);
  });

  it("records that it followed project references", () => {
    expect(g.notes.join(" ")).toMatch(/project reference/);
  });
});

describe("grading (deterministic keyword matcher)", () => {
  const g = indexRepo(FIX);
  const clamp = g.nodes.find((n) => n.name === "clamp")!;
  const [q] = generateQuestions(clamp, g);

  it("scores a strong answer high and a weak answer low", () => {
    const strong = keywordMatcher.grade(
      "clamp takes x, lo, hi and returns a number; if x is below lo or above hi it clamps to the bound, handling those edge branches.",
      q,
    );
    const weak = keywordMatcher.grade("it clamps a value I think", q);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThanOrEqual(4);
  });

  it("is reproducible — same answer, same score", () => {
    const a = "x lo hi number branch";
    expect(keywordMatcher.grade(a, q).score).toBe(keywordMatcher.grade(a, q).score);
  });

  it("every covered point traces to a code-derived concept", () => {
    const r = keywordMatcher.grade("uses x, lo, hi, returns number, handles branches", q);
    for (const c of r.covered) expect(q.expectedConcepts).toContain(c);
  });
});

describe("question altitude (the --level dial)", () => {
  const g = indexRepo(FIX);
  const clamp = g.nodes.find((n) => n.name === "clamp")!;
  const [high] = generateQuestions(clamp, g, "high");
  const [mid] = generateQuestions(clamp, g, "mid");
  const [low] = generateQuestions(clamp, g, "low");

  it("high altitude asks for the rejected alternative (design rationale, not mechanism)", () => {
    expect(high.prompt.toLowerCase()).toContain("alternative");
    expect(high.prompt.toLowerCase()).not.toContain("walk the exact control flow");
  });

  it("low altitude asks to walk the exact control flow (mechanism, not design)", () => {
    expect(low.prompt.toLowerCase()).toContain("control flow");
    expect(low.prompt.toLowerCase()).not.toContain("alternative");
  });

  it("the three altitudes are distinct prompts", () => {
    expect(new Set([high.prompt, mid.prompt, low.prompt]).size).toBe(3);
  });

  it("the keyword rubric is altitude-independent (concepts come from the code, not the question)", () => {
    expect(high.expectedConcepts).toEqual(mid.expectedConcepts);
    expect(low.expectedConcepts).toEqual(mid.expectedConcepts);
  });

  it("defaults to mid when no level is given", () => {
    const [def] = generateQuestions(clamp, g);
    expect(def.prompt).toBe(mid.prompt);
  });
});

describe("dunning-kruger placement", () => {
  it("flags overconfidence honestly (no meme labels)", () => {
    // rated self 5/5 everywhere, measured 1/5 -> big positive gap, low competence
    const p = placeOnCurve([
      { selfRating: 5, score: 1 },
      { selfRating: 5, score: 2 },
      { selfRating: 5, score: 1 },
    ]);
    expect(p.gap).toBeGreaterThan(25);
    expect(p.zone).toBe("confidence ran ahead of competence");
    expect(p.zone).not.toMatch(/Mount Stupid|Valley of Despair/);
  });

  it("normalizes the two scales correctly", () => {
    const p = placeOnCurve([{ selfRating: 5, score: 5 }]);
    expect(p.selfPct).toBe(100);
    expect(p.measuredPct).toBe(100);
    expect(p.gap).toBe(0);
  });
});

describe("substrate edge cases (audit fixes)", () => {
  const g2 = indexRepo(path.join(__dirname, "fixture-edge"));

  it("drops bodiless overload signatures — one `pick`, not three phantoms", () => {
    expect(g2.nodes.filter((n) => n.name === "pick").length).toBe(1);
    // the kept one is the implementation (it has the branch)
    expect(g2.nodes.find((n) => n.name === "pick")!.branchCount).toBeGreaterThan(0);
  });

  it("does not mark nested locals as exported", () => {
    const inner = g2.nodes.find((n) => n.name === "innerHelper");
    expect(inner).toBeDefined();
    expect(inner!.exported).toBe(false);
    expect(g2.nodes.find((n) => n.name === "outer")!.exported).toBe(true);
  });

  it("credits `export { foo }` statement exports", () => {
    expect(g2.nodes.find((n) => n.name === "helper")!.exported).toBe(true);
  });

  it("indexes an anonymous default export and marks it exported", () => {
    const def = g2.nodes.find((n) => n.name === "default");
    expect(def).toBeDefined();
    expect(def!.exported).toBe(true);
  });

  it("public methods of an exported class are exported; private are not", () => {
    expect(g2.nodes.find((n) => n.name === "run")!.exported).toBe(true);
    expect(g2.nodes.find((n) => n.name === "secret")!.exported).toBe(false);
  });
});

describe("teaching loop (buildLesson)", () => {
  const g = indexRepo(FIX);
  const priceOrder = g.nodes.find((n) => n.name === "priceOrder")!;

  it("explains the symbol with code-grounded facts that match the grading concepts", () => {
    const lesson = buildLesson(priceOrder, g, "/* source */");
    const text = lesson.breakdown.join(" ");
    expect(text).toContain("clamp"); // it really does call clamp
    expect(text).toContain("formatMoney");
    expect(text).toMatch(/order/); // the parameter
    expect(lesson.explainBackPrompt.toLowerCase()).toContain("explain");
  });
});

describe("comprehension overlay (onto a graphify vault)", () => {
  // A minimal stand-in for what `graphify export obsidian` writes: per-note YAML frontmatter with
  // source_file + a tags list, a `# name()` heading for functions, an inline #graphify tag line,
  // and an .obsidian/graph.json carrying community colorGroups.
  function makeVault(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dk-vault-"));
    const note = (name: string, file: string, isFn: boolean) =>
      `---\nsource_file: "${file}"\ntype: "code"\ncommunity: "Community 1"\nlocation: "L10"\ntags:\n  - graphify/code\n  - community/Community_1\n---\n\n# ${name}${isFn ? "()" : ""}\n\n#graphify/code #community/Community_1\n`;
    fs.writeFileSync(path.join(dir, "foo().md"), note("foo", "src/x.ts", true));
    fs.writeFileSync(path.join(dir, "bar().md"), note("bar", "src/y.ts", true));
    fs.writeFileSync(path.join(dir, "Widget.md"), note("Widget", "src/z.ts", false)); // not a function
    fs.mkdirSync(path.join(dir, ".obsidian"));
    fs.writeFileSync(
      path.join(dir, ".obsidian", "graph.json"),
      JSON.stringify({ colorGroups: [{ query: "tag:#community/Community_1", color: { a: 1, rgb: 1 } }] }),
    );
    return dir;
  }

  it("colors a scored function note by its bucket and leaves unscored functions untested", () => {
    const dir = makeVault();
    const res = overlayComprehension(dir, { [joinKey("src/x.ts", "foo")]: { score: 0 } });
    expect(res.tagged).toBe(1);
    expect(res.untested).toBe(1); // bar() had no score
    expect(res.unmatched).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "foo().md"), "utf8")).toContain("dk/blackbox");
    expect(fs.readFileSync(path.join(dir, "bar().md"), "utf8")).toContain("dk/untested");
  });

  it("never tags a non-function note", () => {
    const dir = makeVault();
    overlayComprehension(dir, {});
    expect(fs.readFileSync(path.join(dir, "Widget.md"), "utf8")).not.toMatch(/dk\//);
  });

  it("prepends comprehension colorGroups so they win over community color", () => {
    const dir = makeVault();
    overlayComprehension(dir, { [joinKey("src/x.ts", "foo")]: { score: 5 } });
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".obsidian", "graph.json"), "utf8"));
    const queries = cfg.colorGroups.map((c: { query: string }) => c.query);
    expect(queries.slice(0, 4)).toEqual([
      "tag:#dk/understood",
      "tag:#dk/shaky",
      "tag:#dk/blackbox",
      "tag:#dk/untested",
    ]);
    expect(queries).toContain("tag:#community/Community_1"); // community group kept after
  });

  it("is idempotent — re-running re-derives one dk tag, not a stack", () => {
    const dir = makeVault();
    const scores = { [joinKey("src/x.ts", "foo")]: { score: 5 } };
    overlayComprehension(dir, scores);
    overlayComprehension(dir, { [joinKey("src/x.ts", "foo")]: { score: 1 } }); // re-score
    const note = fs.readFileSync(path.join(dir, "foo().md"), "utf8");
    expect((note.match(/- dk\//g) || []).length).toBe(1);
    expect(note).toContain("dk/blackbox"); // reflects the latest score, not the first
    expect(note).not.toContain("dk/understood");
  });

  it("reports scores that match no note (renamed/moved since the interview)", () => {
    const dir = makeVault();
    const res = overlayComprehension(dir, { [joinKey("src/gone.ts", "ghost")]: { score: 3 } });
    expect(res.unmatched).toEqual([joinKey("src/gone.ts", "ghost")]);
  });
});

describe("markdown report", () => {
  const base = {
    title: "demo",
    date: "2026-06-23",
    selfPct: 90,
    measuredPct: 40,
    gap: 50,
    zone: "confidence ran ahead of competence",
  };

  it("renders the gap, a per-symbol table, and a tick-off reading list (weakest first)", () => {
    const md = renderReportMarkdown({
      ...base,
      points: [
        { name: "strong", location: "a.ts:1", self: 4, measured: 5, missed: [] },
        { name: "weak", location: "b.ts:2", self: 5, measured: 1, missed: ["what breaks if null"] },
      ],
    });
    expect(md).toContain("confidence");
    expect(md).toContain("+50%");
    expect(md).toContain("| `strong`"); // the table
    expect(md).toContain("- [ ] `weak` (b.ts:2) — what breaks if null"); // checklist item
    expect(md).not.toContain("- [ ] `strong`"); // nothing missed → not on the list
  });

  it("says nothing's flagged when every answer is covered", () => {
    const md = renderReportMarkdown({
      ...base,
      points: [{ name: "ok", location: "a.ts:1", self: 3, measured: 5, missed: [] }],
    });
    expect(md).toContain("Nothing flagged");
  });

  it("formats per-facet dimensions in the table when present", () => {
    const md = renderReportMarkdown({
      ...base,
      points: [
        {
          name: "f",
          location: "a.ts:1",
          self: 4,
          measured: 2,
          missed: [],
          dimensions: { mechanism: 4, failureModes: 0 },
        },
      ],
    });
    expect(md).toContain("mechanism 4/5");
    expect(md).toContain("failure-modes 0/5");
  });
});

describe("keyword matcher word-boundaries (audit fix)", () => {
  const q: Question = { targetId: "x", type: "explain", prompt: "", expectedConcepts: ["parameter: id"] };
  it("does not credit `id` inside `grid`", () => {
    expect(keywordMatcher.grade("it renders a grid", q).covered).toEqual([]);
  });
  it("does credit a real whole-word mention", () => {
    expect(keywordMatcher.grade("it uses the id field", q).covered).toEqual(["parameter: id"]);
  });
});
