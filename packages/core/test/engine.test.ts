import { describe, it, expect } from "vitest";
import * as path from "path";
import { indexRepo } from "../src/substrate/ts-compiler";
import { pickTargets } from "../src/pickTargets";
import { generateQuestions } from "../src/generateQuestions";
import { keywordMatcher } from "../src/grade/keyword-matcher";
import { placeOnCurve } from "../src/curve";
import { buildLesson } from "../src/teach";
import { renderCurveHtml } from "../src/render/curve-html";
import { buildVault } from "../src/render/obsidian";
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

describe("obsidian vault export", () => {
  const g = indexRepo(FIX);
  const files = buildVault(g);
  const noteFor = (name: string, fs = files) =>
    fs.find((f) => new RegExp(`^# ${name}$`, "m").test(f.content));

  it("emits a note per symbol plus _Home and a graph color config", () => {
    expect(files.some((f) => f.path === "_Home.md")).toBe(true);
    expect(files.some((f) => f.path === ".obsidian/graph.json")).toBe(true);
    const notes = files.filter((f) => f.path.endsWith(".md") && f.path !== "_Home.md");
    expect(notes.length).toBe(g.nodes.length);
  });

  it("renders call edges as wikilinks (priceOrder -> clamp, formatMoney)", () => {
    const note = noteFor("priceOrder")!;
    expect(note.content).toMatch(/\[\[[^\]]*\|clamp\]\]/);
    expect(note.content).toMatch(/\[\[[^\]]*\|formatMoney\]\]/);
  });

  it("tags untested nodes dk/untested", () => {
    expect(noteFor("clamp")!.content).toContain("dk/untested");
  });

  it("colors a node by comprehension score and shows the felt-vs-showed receipt", () => {
    const clamp = g.nodes.find((n) => n.name === "clamp")!;
    const scored = buildVault(g, { scores: { [clamp.id]: { score: 0, self: 5 } } });
    const note = noteFor("clamp", scored)!;
    expect(note.content).toContain("dk/blackbox");
    expect(note.content).toContain("you felt 5/5, you showed 0/5");
  });

  it("breaks the score into per-facet dimensions when present", () => {
    const clamp = g.nodes.find((n) => n.name === "clamp")!;
    const scored = buildVault(g, {
      scores: { [clamp.id]: { score: 2, self: 4, dimensions: { mechanism: 4, failureModes: 0 } } },
    });
    const note = noteFor("clamp", scored)!;
    expect(note.content).toContain("mechanism: 4/5");
    expect(note.content).toContain("failure modes: 0/5");
    expect(note.content).toContain("you showed 2/5 overall");
  });

  it("the graph config maps comprehension tags to colors", () => {
    const cfg = JSON.parse(files.find((f) => f.path === ".obsidian/graph.json")!.content);
    const queries = cfg.colorGroups.map((c: { query: string }) => c.query);
    expect(queries).toContain("tag:#dk/blackbox");
    expect(queries).toContain("tag:#dk/understood");
  });

  it("produces unique note paths", () => {
    const paths = files.filter((f) => f.path.endsWith(".md")).map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("curve html artifact", () => {
  it("renders a self-contained, honest SVG card", () => {
    const html = renderCurveHtml({
      title: "demo",
      date: "2026-06-22",
      selfPct: 90,
      measuredPct: 40,
      gap: 50,
      zone: "confidence ran ahead of competence",
      points: [{ name: "foo", selfPct: 90, measuredPct: 40 }],
    });
    expect(html).toContain("<svg");
    expect(html).toContain("40%"); // competence number
    expect(html).toContain("confidence ran ahead of competence"); // honest zone
    expect(html).toContain("isn't in Kruger"); // the meme caveat is present, not the meme curve
  });
  it("escapes html in user-supplied names", () => {
    const html = renderCurveHtml({
      title: "x",
      date: "d",
      selfPct: 0,
      measuredPct: 0,
      gap: 0,
      zone: "z",
      points: [{ name: "<script>", selfPct: 0, measuredPct: 0 }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("never renders NaN/Infinity in numeric fields", () => {
    const html = renderCurveHtml({
      title: "x",
      date: "d",
      selfPct: NaN,
      measuredPct: Infinity,
      gap: NaN,
      zone: "z",
      points: [{ name: "p", selfPct: NaN, measuredPct: -50 }],
    });
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    // every non-finite input collapses to a safe 0, never garbage text
    expect(html).toContain("0%");
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
