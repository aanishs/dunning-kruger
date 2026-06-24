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
import { renameDomains } from "../src/render/domains";
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

  it("sets a default graph filter to hide the _COMMUNITY_ scaffolding", () => {
    const dir = makeVault();
    overlayComprehension(dir, {});
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".obsidian", "graph.json"), "utf8"));
    expect(cfg.search).toContain("_COMMUNITY_");
  });

  it("does not clobber an existing user graph search filter", () => {
    const dir = makeVault();
    const gj = path.join(dir, ".obsidian", "graph.json");
    fs.writeFileSync(gj, JSON.stringify({ colorGroups: [], search: "tag:#mine" }));
    overlayComprehension(dir, {});
    expect(JSON.parse(fs.readFileSync(gj, "utf8")).search).toBe("tag:#mine");
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

describe("domain naming (renameDomains)", () => {
  // A stand-in graphify vault: a member note (frontmatter community field + tag + inline tag), a
  // _COMMUNITY_ index note, a graph.canvas with group labels, and .obsidian/graph.json colorGroups.
  function makeVault(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dk-domains-"));
    fs.writeFileSync(
      path.join(dir, "foo().md"),
      `---\nsource_file: "src/x.ts"\ntype: "code"\ncommunity: "Community 1"\nlocation: "L10"\ntags:\n  - graphify/code\n  - community/Community_1\n---\n\n# foo()\n\n#graphify/code #community/Community_1\n`,
    );
    // a SECOND community whose number is a prefix of the first ("Community 1" vs "Community 10")
    fs.writeFileSync(
      path.join(dir, "baz().md"),
      `---\nsource_file: "src/z.ts"\ncommunity: "Community 10"\ntags:\n  - community/Community_10\n---\n\n# baz()\n\n#community/Community_10\n`,
    );
    fs.writeFileSync(
      path.join(dir, "_COMMUNITY_Community 1.md"),
      `---\ntype: community\nmembers: 1\n---\n\n# Community 1\n\n## Members\n- [[foo()]]\n`,
    );
    fs.writeFileSync(
      path.join(dir, "graph.canvas"),
      JSON.stringify({ nodes: [{ type: "group", label: "Community 1" }, { type: "group", label: "Community 10" }] }),
    );
    fs.mkdirSync(path.join(dir, ".obsidian"));
    fs.writeFileSync(
      path.join(dir, ".obsidian", "graph.json"),
      JSON.stringify({ colorGroups: [{ query: "tag:#community/Community_1", color: { a: 1, rgb: 1 } }] }),
    );
    return dir;
  }

  it("renames a community across notes, tags, index note, canvas, and graph.json", () => {
    const dir = makeVault();
    const res = renameDomains(dir, { "Community 1": "Auth" });
    expect(res.renamed).toBe(1);

    const note = fs.readFileSync(path.join(dir, "foo().md"), "utf8");
    expect(note).toContain('community: "Auth"');
    expect(note).toContain("community/Auth"); // frontmatter tag AND inline tag
    expect(note).not.toContain("community/Community_1");

    expect(fs.existsSync(path.join(dir, "_COMMUNITY_Auth.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "_COMMUNITY_Community 1.md"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "_COMMUNITY_Auth.md"), "utf8")).toContain("# Auth");

    const canvas = JSON.parse(fs.readFileSync(path.join(dir, "graph.canvas"), "utf8"));
    expect(canvas.nodes.map((n: { label: string }) => n.label)).toContain("Auth");

    const gj = JSON.parse(fs.readFileSync(path.join(dir, ".obsidian", "graph.json"), "utf8"));
    expect(gj.colorGroups[0].query).toBe("tag:#community/Auth");
  });

  it("does NOT corrupt Community 10 when renaming Community 1 (prefix-collision guard)", () => {
    const dir = makeVault();
    renameDomains(dir, { "Community 1": "Auth" });
    const baz = fs.readFileSync(path.join(dir, "baz().md"), "utf8");
    expect(baz).toContain("community/Community_10"); // untouched
    expect(baz).toContain('community: "Community 10"');
    const canvas = JSON.parse(fs.readFileSync(path.join(dir, "graph.canvas"), "utf8"));
    expect(canvas.nodes.map((n: { label: string }) => n.label)).toContain("Community 10");
  });

  it("slugifies a spaced domain name into a valid tag but keeps the display name", () => {
    const dir = makeVault();
    renameDomains(dir, { "Community 1": "Patient Management" });
    const note = fs.readFileSync(path.join(dir, "foo().md"), "utf8");
    expect(note).toContain("community/Patient_Management"); // tag-safe
    expect(note).toContain('community: "Patient Management"'); // human display
  });

  it("reports mapping keys that match nothing", () => {
    const dir = makeVault();
    const res = renameDomains(dir, { "Community 99": "Ghost" });
    expect(res.unmatched).toEqual(["Community 99"]);
    expect(res.renamed).toBe(0);
  });

  it("rewrites inbound [[_COMMUNITY_...]] wikilinks so renamed communities don't orphan", () => {
    const dir = makeVault();
    fs.writeFileSync(
      path.join(dir, "x().md"),
      `---\nsource_file: "src/x.ts"\ncommunity: "Community 1"\ntags:\n  - community/Community_1\n---\n\n# x()\n\n- [[_COMMUNITY_Community 1]]\n- [[_COMMUNITY_Community 1|the auth one]]\n- [[_COMMUNITY_Community 10|ten]]\n`,
    );
    renameDomains(dir, { "Community 1": "Auth" });
    const note = fs.readFileSync(path.join(dir, "x().md"), "utf8");
    expect(note).toContain("[[_COMMUNITY_Auth]]"); // plain wikilink retargeted to the renamed file
    expect(note).toContain("[[_COMMUNITY_Auth|the auth one]]"); // aliased link retargeted, alias kept
    expect(note).not.toContain("[[_COMMUNITY_Community 1]]");
    expect(note).not.toContain("[[_COMMUNITY_Community 1|");
    expect(note).toContain("[[_COMMUNITY_Community 10|ten]]"); // boundary: Community 10 untouched
  });

  it("rejects an invalid mapping before writing anything (dupes / non-string)", () => {
    const dir = makeVault();
    expect(() => renameDomains(dir, { "Community 1": "Auth", "Community 10": "Auth" })).toThrow(/same name/i);
    expect(() => renameDomains(dir, { "Community 1": null })).toThrow(/string/i);
    expect(() => renameDomains(dir, { "Community 1": 'has"quote' })).toThrow(/quotes/i);
    // the vault was not mutated by a rejected run
    expect(fs.readFileSync(path.join(dir, "foo().md"), "utf8")).toContain('community: "Community 1"');
  });

  it("treats $ in a name as literal, not a regex backreference, and keeps YAML intact", () => {
    const dir = makeVault();
    renameDomains(dir, { "Community 1": "A$1B" });
    const note = fs.readFileSync(path.join(dir, "foo().md"), "utf8");
    expect(note).toContain('community: "A$1B"'); // $1 stayed literal
    expect(note).toContain("community/A_1B"); // tag-slugged
  });
});

describe("substrate without body facts (graphify path)", () => {
  it("keyword matcher reports ungradable (not 'Solid') when there are no concepts", () => {
    const q = { targetId: "x", type: "explain", prompt: "?", expectedConcepts: [] } as unknown as Question;
    const r = keywordMatcher.grade("anything", q) as { learnNext: string; reason: string };
    expect(r.learnNext).not.toMatch(/solid/i);
    expect(r.learnNext).toMatch(/--smart|skill/i);
    expect(r.reason).toMatch(/not gradable|no params|substrate/i);
  });

  it("buildLesson says 'not extracted' for params/branches when bodyFacts is false", () => {
    const node = { id: "a#f:1", name: "f", kind: "function", file: "a.py", line: 1, endLine: 1, exported: true, params: [], branchCount: 0, callees: [], loc: 1 } as unknown as Parameters<typeof buildLesson>[0];
    const graph = { repo: "/r", nodes: [node], inDegree: {}, notes: [], bodyFacts: false } as unknown as Parameters<typeof buildLesson>[1];
    const text = buildLesson(node, graph, "def f(): ...").breakdown.join(" | ");
    expect(text).toMatch(/not extracted by this substrate/i);
    expect(text).not.toContain("No branches — it runs straight through");
  });

  it("buildLesson keeps the confident wording on the TS substrate (bodyFacts undefined)", () => {
    const node = { id: "a#f:1", name: "f", kind: "function", file: "a.ts", line: 1, endLine: 3, exported: false, params: [], branchCount: 0, callees: [], loc: 3 } as unknown as Parameters<typeof buildLesson>[0];
    const graph = { repo: "/r", nodes: [node], inDegree: {}, notes: [] } as unknown as Parameters<typeof buildLesson>[1];
    expect(buildLesson(node, graph, "function f(){}").breakdown.join(" | ")).toContain("No branches");
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
