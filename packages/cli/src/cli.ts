#!/usr/bin/env node
// dk — Dunning Kruger CLI.
//
//   dk index    <repo>       index a repo, show symbol + call-edge counts
//   dk targets  <repo> [n]   show the top-N interview targets
//   dk questions<repo> [n]   show questions + the code-derived concepts (the offline recall check)
//   dk interview<repo> [n]   the real thing: self-rate, get grilled, see your gap
//   dk teach    <repo> [sym] explain a symbol against the code, then have you explain it back
//
// Import is relative for the spike so `tsx` runs it with zero build step; the published
// CLI imports the built `@dunning-kruger/core`.
import * as fs from "fs";
import * as path from "path";
import * as readline from "node:readline";
import { execFileSync } from "child_process";
import {
  indexRepo,
  pickTargets,
  generateQuestions,
  keywordMatcher,
  placeOnCurve,
  buildLesson,
  renderReportMarkdown,
  overlayComprehension,
  joinKey,
  renameDomains,
  llmFreeEnv,
  Target,
  Question,
  GradeResult,
  SymbolGraph,
  SymbolNode,
  SymbolScore,
  Matcher,
  Level,
} from "../../core/src/index";
import { parseRatings } from "./parse";
import { makeAgentMatcher } from "./grade/agent-matcher";

// Question altitude from flags: --level=high|mid|low, with --high / --low shorthands.
// All start with "--", so they're already stripped from positional parsing.
function parseLevel(argv: string[]): Level {
  const kv = argv.find((a) => a.startsWith("--level="));
  if (kv) {
    const v = kv.slice("--level=".length);
    if (v === "high" || v === "mid" || v === "low") return v;
  }
  if (argv.includes("--high")) return "high";
  if (argv.includes("--low")) return "low";
  return "mid";
}

async function main(argv: string[]): Promise<number> {
  // `--smart` opts the standalone CLI into agent grading (shells to the user's own
  // claude -p / codex — their sub, no API key). Strip flags before positional parsing.
  const smart = argv.includes("--smart");
  const level = parseLevel(argv);
  const [cmd, repoArg, nArg] = argv.filter((a) => !a.startsWith("--"));
  const repo = repoArg ?? process.cwd();
  const n = nArg ? parseInt(nArg, 10) : 5;

  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log("dk index|targets|questions|interview|teach|report|vault|name-domains <repo> [n|symbol|out]");
      console.log("  report <repo> [out.md]   write a markdown calibration report (gap + reading list)");
      console.log("  vault <repo> [dir]       build the graphify Obsidian vault, colored by your");
      console.log("                           comprehension (needs graphify: `pip install graphifyy`)");
      console.log("  name-domains <vault> <map.json>  apply community names {\"Community 6\":\"Auth\"} to a vault");
      console.log("  --smart          grade with your own claude -p / codex (your sub, no API key)");
      console.log("  --level=<high|mid|low>   question altitude: high = design/why (default mid = blast-radius,");
      console.log("                           low = line-level mechanism). Aliases: --high, --low");
      return 0;
    case "index":
      return cmdIndex(repo);
    case "targets":
      return cmdTargets(repo, n);
    case "questions":
      return cmdQuestions(repo, n, level);
    case "interview":
      return cmdInterview(repo, n, smart, level);
    case "teach":
      return cmdTeach(repo, nArg, level);
    case "curve":
    case "report":
      return cmdReport(repo, nArg);
    case "vault":
    case "obsidian":
      return cmdVault(repo, nArg);
    case "name-domains":
      return cmdNameDomains(repoArg, nArg);
    default:
      console.error(`unknown command: ${cmd}`);
      return 1;
  }
}

function cmdIndex(repo: string): number {
  const g = indexRepo(repo);
  const edges = g.nodes.reduce((s, x) => s + x.callees.length, 0);
  console.log(`repo:    ${g.repo}`);
  console.log(`symbols: ${g.nodes.length}`);
  console.log(`call edges (intra-repo): ${edges}`);
  if (g.notes.length) console.log(`notes:   ${g.notes.join(" | ")}`);
  return 0;
}

function cmdTargets(repo: string, n: number): number {
  const g = indexRepo(repo);
  const targets = pickTargets(g, n);
  if (!targets.length) return say("No rankable symbols found (repo too small).");
  console.log(`Top ${targets.length} interview targets in ${g.repo}:\n`);
  targets.forEach((t, i) =>
    console.log(
      `${i + 1}. ${t.name}  (${t.file}:${t.line})  [rank ${t.rank.toFixed(1)} · ` +
        `${t.inDegree} callers · ${t.callees.length} callees · ${t.branchCount} branches · ` +
        `${t.loc} loc${t.exported ? " · exported" : ""}]`,
    ),
  );
  return 0;
}

function cmdQuestions(repo: string, n: number, level: Level = "mid"): number {
  const g = indexRepo(repo);
  const targets = pickTargets(g, n);
  if (!targets.length) return say("No rankable symbols found.");
  targets.forEach((t, i) => {
    const [q] = generateQuestions(t, g, level);
    console.log(`Q${i + 1} [${q.type}] ${q.prompt}`);
    for (const c of q.expectedConcepts) console.log(`     - ${c}`);
    console.log();
  });
  return 0;
}

interface AnsweredTarget {
  target: Target;
  question: Question;
  grade: GradeResult;
  selfRating: number;
}

async function cmdInterview(
  repo: string,
  n: number,
  smart = false,
  level: Level = "mid",
): Promise<number> {
  const g = indexRepo(repo);
  const targets = pickTargets(g, n);
  if (!targets.length) return say("No rankable symbols found — repo too small to interview on.");

  let matcher: Matcher = keywordMatcher;
  if (smart) {
    const agent = makeAgentMatcher(repo);
    if (agent) {
      matcher = agent;
      console.log(`(grading with ${agent.name} — your own session/sub, no API key)`);
    } else {
      console.log("(--smart: no claude/codex CLI on PATH; using the keyword fallback)");
    }
  }
  if (level === "high" && matcher === keywordMatcher) {
    // Design-rationale answers barely echo identifiers, so the keyword floor can't grade them
    // fairly. Be honest about it and point at the path that can.
    console.log(
      "(--level=high asks design/why questions; the keyword fallback can't grade those well —\n" +
        " add --smart, or run the /dunning-kruger skill so your session model judges them.)",
    );
  }

  const reader = makeReader();
  console.log(`\nDunning Kruger — interviewing you on ${g.repo}`);
  console.log(`(${targets.length} of them. Answer from memory, no peeking — it only works if you're honest with yourself.)\n`);
  console.log("First, rate how well you think you understand each, 1 (no idea) to 5 (could rewrite it from scratch):");
  targets.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}  (${t.file}:${t.line})`));
  const ratings = parseRatings(await reader.ask(`\nself-ratings (e.g. ${targets.map(() => "3").join(",")}): `), targets.length);

  const answered: AnsweredTarget[] = [];
  for (let i = 0; i < targets.length; i++) {
    const [question] = generateQuestions(targets[i], g, level);
    console.log(`\nQ${i + 1}/${targets.length}: ${question.prompt}`);
    const answer = await reader.ask("> ");
    let grade: GradeResult;
    try {
      grade = await matcher.grade(answer, question);
    } catch {
      console.log("  (semantic grader failed for this one — fell back to the keyword check)");
      grade = await keywordMatcher.grade(answer, question); // agent tool failed — fall back to the floor
    }
    answered.push({ target: targets[i], question, grade, selfRating: ratings[i] });
  }
  const placement = placeOnCurve(answered.map((a) => ({ selfRating: a.selfRating, score: a.grade.score })));
  printResults(answered, placement);
  const prev = persist(g.repo, answered, placement);
  printOverTime(placement, prev);
  printVerdict(answered);

  // Teaching loop (protege effect): offer to close the gap on the weakest target.
  const weakest = [...answered].sort((a, b) => a.grade.score - b.grade.score)[0];
  if (weakest && weakest.grade.score < 4) {
    const yn = (await reader.ask(`\nWant to close the gap on ${weakest.target.name}? (y/n) `)).trim().toLowerCase();
    if (yn === "y" || yn === "yes") {
      // re-grade with the SAME matcher the interview used (keyword or --smart agent).
      const regrade = await teachLoop(reader, g, weakest.target, matcher, weakest.grade.score, level);
      // TEACHING.md: update the overlay if they re-score higher, so the over-time view reflects it.
      if (regrade.score > weakest.grade.score) updateOverlayScore(g.repo, weakest.target, regrade);
    }
  }
  reader.close();
  return 0;
}

function updateOverlayScore(repo: string, target: Target, grade: GradeResult): void {
  const file = path.join(repo, ".dunning-kruger", "overlay.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return;
    const runs = parsed as OverlayRun[];
    const last = runs[runs.length - 1];
    const row = last?.targets?.find((t) => t.symbol === target.name && t.file === `${target.file}:${target.line}`);
    if (row && grade.score > row.measured) {
      row.measured = grade.score;
      row.missed = grade.missed; // keep the missed-list consistent with the new score
      // recompute the overall calibration so the curve / over-time view isn't stale
      const p = placeOnCurve(last.targets.map((t) => ({ selfRating: t.self, score: t.measured })));
      last.overall = { selfPct: p.selfPct, measuredPct: p.measuredPct, gap: p.gap, zone: p.zone };
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(runs, null, 2));
      fs.renameSync(tmp, file);
      console.log(`  (logged your climb — ${target.name} is now ${grade.score}/5; overall recomputed)`);
    }
  } catch {
    /* overlay missing/corrupt: the lesson still happened, just not recorded */
  }
}

async function cmdTeach(repo: string, nameArg?: string, level: Level = "mid"): Promise<number> {
  const g = indexRepo(repo);
  let target: Target | undefined;
  // A non-numeric arg is a symbol name. Use a strict digits test, not isNaN(parseInt) —
  // "f1"/"v2" parse to a number but are names, not indices.
  if (nameArg && !/^\d+$/.test(nameArg.trim())) {
    target = pickTargets(g, 10_000).find((x) => x.name === nameArg);
    if (!target) return say(`No symbol named "${nameArg}" found.`);
  }
  if (!target) target = pickTargets(g, 1)[0];
  if (!target) return say("No rankable symbols found.");
  const reader = makeReader();
  await teachLoop(reader, g, target, keywordMatcher, undefined, level);
  reader.close();
  return 0;
}

function cmdReport(repo: string, outArg?: string): number {
  const run = latestRun(repo);
  if (!run) return say("No saved run yet — run `dk interview` first.");
  const md = renderReportMarkdown({
    title: `Dunning Kruger — ${path.basename(path.resolve(repo))}`,
    date: run.date.slice(0, 10),
    selfPct: run.overall.selfPct,
    measuredPct: run.overall.measuredPct,
    gap: run.overall.gap,
    zone: run.overall.zone,
    points: run.targets.map((t) => ({
      name: t.symbol,
      location: t.file,
      self: t.self,
      measured: t.measured,
      missed: t.missed,
      dimensions: t.dimensions,
    })),
  });
  const out = outArg && !/^\d+$/.test(outArg) ? outArg : path.join(repo, ".dunning-kruger", "report.md");
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md);
    console.log(`wrote ${out} — your calibration report (open it in any markdown viewer).`);
  } catch (e) {
    return say(`couldn't write ${out}: ${(e as Error).message}`);
  }
  return 0;
}

// `dk vault` no longer hand-rolls an Obsidian export. graphify (github.com/safishamsi/graphify)
// owns the graph: tree-sitter extraction, Leiden communities, and the vault itself. We run it
// LLM-free, then overlay YOUR comprehension (dk/* tags + colorGroups) onto the notes it wrote.
function cmdVault(repo: string, outArg?: string): number {
  const root = path.resolve(repo);
  const out = outArg && !/^\d+$/.test(outArg) ? path.resolve(outArg) : path.join(root, ".dunning-kruger", "vault");

  const built = buildGraphifyVault(root, out);
  if (!built.ok) return say(built.error);

  // Scores keyed by joinKey(file, name) straight from the overlay (no re-index needed); the
  // overlay rows already carry symbol name + "file:line".
  const scores: Record<string, SymbolScore> = {};
  const run = latestRun(root);
  for (const t of run?.targets ?? []) {
    const file = t.file.replace(/:\d+$/, ""); // "path/x.ts:42" -> "path/x.ts"
    scores[joinKey(file, t.symbol)] = { score: t.measured, self: t.self, dimensions: t.dimensions };
  }

  const res = overlayComprehension(out, scores);
  console.log(`built the graphify vault at ${out} and overlaid your comprehension.`);
  console.log(`  ${res.tagged} function(s) colored, ${res.untested} not yet tested.`);
  if (res.unmatched.length) {
    console.log(`  (${res.unmatched.length} score(s) matched no note — renamed/moved since the interview.)`);
  }
  console.log(
    Object.keys(scores).length
      ? "open that folder as an Obsidian vault, then Graph view (Cmd/Ctrl+G) — red = black box."
      : "open it as an Obsidian vault, then run `dk interview` and re-run `dk vault` to color it.",
  );
  return 0;
}

// Run graphify's three LLM-free steps: extract -> cluster (Leiden, --no-label so no LLM naming)
// -> export the vault. graphify is a Python tool; we shell to it (GRAPHIFY_BIN overrides the path).
function buildGraphifyVault(root: string, outDir: string): { ok: true } | { ok: false; error: string } {
  const bin = process.env.GRAPHIFY_BIN || "graphify";
  // Strip LLM API keys from graphify's env: every step we run is local/no-LLM, and the tool must
  // never be able to reach a paid API on the user's behalf.
  const run = (args: string[]) =>
    execFileSync(bin, args, {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
      env: llmFreeEnv(),
    });
  try {
    run(["update", root, "--no-cluster", "--force"]);
    run(["cluster-only", root, "--no-label", "--no-viz"]);
    run(["export", "obsidian", "--dir", outDir]);
    return { ok: true };
  } catch (e) {
    const msg = (e as { code?: string }).code === "ENOENT"
      ? `graphify not found (looked for "${bin}"). Install it with \`pip install graphifyy\`, or set GRAPHIFY_BIN.`
      : `graphify failed while building the vault: ${(e as Error).message}`;
    return { ok: false, error: msg };
  }
}

// Apply a model-produced community-name mapping to a built vault. The SKILL (DOMAINS.md) has the
// in-session model read the _COMMUNITY_ member lists and write the JSON; this just applies it.
function cmdNameDomains(arg1?: string, arg2?: string): number {
  let vaultArg = arg1;
  let mappingArg = arg2;
  // `dk name-domains <mapping-file>` → use the default vault when the lone arg is an existing file.
  if (arg1 && !arg2) {
    const isFile = (() => { try { return fs.statSync(arg1).isFile(); } catch { return false; } })();
    if (isFile) { mappingArg = arg1; vaultArg = undefined; }
  }
  if (!mappingArg) {
    return say(`usage: dk name-domains <vault-dir> <mapping.json>   (mapping: {"Community 6":"Auth"})`);
  }
  const vault = vaultArg ? path.resolve(vaultArg) : path.join(process.cwd(), ".dunning-kruger", "vault");
  if (!fs.existsSync(vault)) return say(`no vault at ${vault} — run \`dk vault\` first.`);
  let mapping: unknown;
  try {
    mapping = JSON.parse(fs.readFileSync(mappingArg, "utf8"));
  } catch (e) {
    return say(`couldn't read mapping ${mappingArg}: ${(e as Error).message}`);
  }
  let res;
  try {
    res = renameDomains(vault, mapping as Record<string, unknown>); // validates + throws on a bad mapping
  } catch (e) {
    return say((e as Error).message);
  }
  console.log(res.notes[res.notes.length - 1]);
  if (res.unmatched.length) {
    console.log(`  (${res.unmatched.length} unmatched — already renamed, or no such community: ${res.unmatched.join(", ")})`);
  }
  return 0;
}

async function teachLoop(
  reader: ReturnType<typeof makeReader>,
  g: SymbolGraph,
  target: Target,
  matcher: Matcher,
  priorScore?: number,
  level: Level = "mid",
): Promise<GradeResult> {
  const lesson = buildLesson(target, g, readSource(g.repo, target));
  console.log(`\n${"=".repeat(60)}\nLet's close the gap on ${lesson.name} (${lesson.location})\n${"=".repeat(60)}`);
  console.log("\nHere's what it actually does:\n");
  console.log(lesson.source.split("\n").map((l) => "  " + l).join("\n"));
  console.log("\nWhat the code contains:");
  for (const b of lesson.breakdown) console.log(`  • ${b}`);

  const back = await reader.ask(`\n${lesson.explainBackPrompt}\n> `);
  const [q] = generateQuestions(target, g, level);
  let regrade: GradeResult;
  try {
    regrade = await matcher.grade(back, q);
  } catch {
    regrade = await keywordMatcher.grade(back, q);
  }

  console.log(`\nExplain-back: ${regrade.score}/5`);
  if (priorScore !== undefined) {
    const delta = regrade.score - priorScore;
    if (delta > 0) console.log(`You went ${priorScore}/5 → ${regrade.score}/5. That's the climb — you just learned it.`);
    else if (delta === 0) console.log(`Same as before (${regrade.score}/5). Give the branches another read — you're close.`);
    else console.log(`Lower this pass (${regrade.score}/5) — that happens when you stop guessing and start engaging. One more and it sticks.`);
  }
  console.log(regrade.missed.length ? `Still to nail: ${regrade.missed.join("; ")}` : "You covered all of it that time. Nailed it.");
  return regrade;
}

function readSource(repo: string, node: SymbolNode): string {
  try {
    const lines = fs.readFileSync(path.join(repo, node.file), "utf8").split("\n");
    return lines.slice(node.line - 1, node.endLine).join("\n");
  } catch {
    return "(source unavailable)";
  }
}

function printResults(answered: AnsweredTarget[], p: ReturnType<typeof placeOnCurve>): void {
  console.log(`\n${"=".repeat(60)}\nYour scorecard\n${"=".repeat(60)}`);
  for (const a of answered) {
    const selfPct = Math.round(((a.selfRating - 1) / 4) * 100);
    const measPct = Math.round((a.grade.score / 5) * 100);
    console.log(`\n${a.target.name} (${a.target.file}:${a.target.line})`);
    console.log(`  you rated ${a.selfRating}/5 (${selfPct}%)  ·  measured ${a.grade.score}/5 (${measPct}%)`);
    const facets = formatDimensions(a.grade.dimensions);
    if (facets) console.log(`  facets: ${facets}`);
    if (a.grade.covered.length) console.log(`  ✓ you covered: ${a.grade.covered.join("; ")}`);
    if (a.grade.missed.length) console.log(`  → to learn:    ${a.grade.missed.join("; ")}`);
    console.log(`  next: ${a.grade.learnNext}`);
  }
  printCurve(p);
}

const DIMENSION_LABELS: Record<string, string> = {
  mechanism: "mechanism",
  failureModes: "failure-modes",
  blastRadius: "blast-radius",
  rationale: "rationale",
};

function formatDimensions(dims?: GradeResult["dimensions"]): string {
  if (!dims) return "";
  const parts = Object.entries(dims).map(([k, v]) => `${DIMENSION_LABELS[k] ?? k} ${v}/5`);
  return parts.join(" · ");
}

function printCurve(p: ReturnType<typeof placeOnCurve>): void {
  // The famous "Mount Stupid" curve isn't in Kruger & Dunning's paper — it's an internet
  // cartoon of it. So we don't draw it. We show the two honest numbers and the gap.
  console.log(`\n${"=".repeat(60)}\nWhere you actually landed\n${"=".repeat(60)}`);
  console.log(`  confidence (what you felt):   ${p.selfPct}%`);
  console.log(`  competence (what you showed): ${p.measuredPct}%`);
  console.log(`  gap: ${p.gap > 0 ? "+" : ""}${p.gap}%  ·  ${p.zone}`);
  if (p.gap >= 25) {
    console.log(`\n  You rated yourself well above what you could show just now. That's not a`);
    console.log(`  knock — it's the most useful result in the run. It's exactly where the`);
    console.log(`  learning is.`);
  } else if (p.gap <= -10) {
    console.log(`\n  You sold yourself short — you understand this better than you gave`);
    console.log(`  yourself credit for.`);
  }
}

function printVerdict(answered: AnsweredTarget[]): void {
  const exposed = answered.filter((a) => (a.selfRating - 1) / 4 - a.grade.score / 5 >= 0.2).length;
  console.log(`\n${"-".repeat(60)}`);
  if (exposed >= 2) {
    console.log(`${exposed} of ${answered.length} answers came in under what you'd have guessed.`);
    console.log(`That's not a verdict — it's your reading list. Start with the weakest one.`);
  } else {
    console.log(`Only ${exposed} came in under your own rating — you genuinely know this code.`);
    console.log(`Worth knowing for sure rather than hoping.`);
  }
}

// ---- overlay (JSON for v1; SQLite is the productized store) ----
interface OverlayRun {
  date: string;
  overall: { selfPct: number; measuredPct: number; gap: number; zone: string };
  targets: {
    symbol: string;
    file: string;
    self: number;
    measured: number;
    missed: string[];
    dimensions?: GradeResult["dimensions"];
  }[];
}

/** The most recent recorded interview, or undefined if none/unreadable. */
function latestRun(repo: string): OverlayRun | undefined {
  const file = path.join(path.resolve(repo), ".dunning-kruger", "overlay.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as OverlayRun[])[parsed.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

function persist(repo: string, answered: AnsweredTarget[], p: ReturnType<typeof placeOnCurve>): OverlayRun | undefined {
  const dir = path.join(repo, ".dunning-kruger");
  const file = path.join(dir, "overlay.json");
  let runs: OverlayRun[] = [];
  if (fs.existsSync(file)) {
    let parsed: unknown = null;
    let readOk = false;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      readOk = true;
    } catch {
      readOk = false;
    }
    if (readOk && Array.isArray(parsed)) {
      runs = parsed as OverlayRun[];
    } else {
      // Unreadable OR wrong shape (e.g. `{}`): preserve it instead of silently overwriting
      // history. Back it up rather than destroy it.
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
        console.log(`(overlay.json was unreadable; backed it up as overlay.json.corrupt-* and started fresh)`);
      } catch {
        /* best effort */
      }
      runs = [];
    }
  }
  const prev = runs[runs.length - 1];
  const run: OverlayRun = {
    date: new Date().toISOString(),
    overall: { selfPct: p.selfPct, measuredPct: p.measuredPct, gap: p.gap, zone: p.zone },
    targets: answered.map((a) => ({
      symbol: a.target.name,
      file: `${a.target.file}:${a.target.line}`,
      self: a.selfRating,
      measured: a.grade.score,
      missed: a.grade.missed,
      ...(a.grade.dimensions ? { dimensions: a.grade.dimensions } : {}),
    })),
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Write a PROCESS-UNIQUE temp file then rename, so a crash mid-write can't corrupt the
    // overlay and two concurrent runs don't fight over the same tmp path. (Still last-writer-
    // wins on the final file under true concurrency — a real lock is a later item.)
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify([...runs, run], null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.log(`(couldn't save overlay: ${(e as Error).message} — results above still stand)`);
  }
  return prev;
}

function printOverTime(p: ReturnType<typeof placeOnCurve>, prev?: OverlayRun): void {
  if (!prev) return;
  const delta = Math.round((p.measuredPct - prev.overall.measuredPct) * 10) / 10;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  console.log(`\n  over time: last run measured ${prev.overall.measuredPct}% → now ${p.measuredPct}% (${dir} ${Math.abs(delta)} pts)`);
}

// ---- stdin (works interactively AND with piped input) ----
function makeReader() {
  const rl = readline.createInterface({ input: process.stdin });
  const queued: string[] = [];
  const waiting: ((s: string) => void)[] = [];
  let closed = false;
  rl.on("line", (line) => {
    const w = waiting.shift();
    if (w) w(line);
    else queued.push(line);
  });
  // EOF (piped input ran out, or ctrl-D): resolve any pending asks with "" instead of
  // hanging forever (Codex bug #1). An empty answer just grades as 0 — no deadlock.
  rl.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()!("");
  });
  return {
    ask(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      return new Promise((resolve) => {
        const q = queued.shift();
        if (q !== undefined) resolve(q);
        else if (closed) resolve("");
        else waiting.push(resolve);
      });
    },
    close: () => rl.close(),
  };
}

function say(msg: string): number {
  console.log(msg);
  return 0;
}

// Only run when invoked directly — guarded so a test can import parseRatings (and others)
// without executing the CLI. Set exitCode instead of process.exit() so buffered stdout
// fully drains when piped; the event loop ends once readline (if any) is closed.
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
