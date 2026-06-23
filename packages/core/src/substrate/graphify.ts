// Substrate adapter #2: graphify (the RENTED, polyglot deterministic graph).
//
// We do NOT build a graph engine. graphify (github.com/safishamsi/graphify, MIT) already does
// tree-sitter AST extraction across 36 languages with NO LLM for code, plus cross-package
// import/re-export resolution. We shell out to `graphify update <repo>` and project its
// `graph.json` onto the SAME SymbolGraph that ts-compiler.ts produces, so everything downstream
// (pickTargets, generateQuestions, the overlay) is substrate-agnostic.
//
// DETERMINISM: graphify tags every edge `confidence: EXTRACTED | INFERRED | AMBIGUOUS`.
// EXTRACTED == tree-sitter (deterministic). We keep ONLY those by default, so the call graph an
// interview is built on never contains an LLM-inferred edge. (Verified: code-only extraction is
// ~566/567 EXTRACTED.)
//
// What transfers cleanly from graph.json:
//   - call edges  -> SymbolNode.callees   (relation `calls`/`method`, EXTRACTED)
//   - centrality  -> SymbolGraph.inDegree (derived from callees)
//   - file/line/name/kind, and an `exported` PROXY (a node imported/re-exported, or called
//     from another file, is treated as public surface — graphify carries no export modifier).
//
// What graph.json does NOT carry, so we APPROXIMATE (and say so in notes[]):
//   - params (= [])          -> "what breaks if <param> is null" questions degrade
//   - branchCount (= 0)      -> low-level control-flow questions degrade
//   - the declaration SPAN   -> endLine = line unless graphify emits an L<a>-L<b> range, so
//                               source-span pulls (teach / Lesson.source) are weaker
// These are exactly the AST body-facts ts-compiler.ts reads directly. Keeping graphify as the
// SOLE substrate means accepting the approximation OR re-enriching body facts per node from
// source (a slim TS pass for .ts, tree-sitter for others) — that trade is the slice-4 call.

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { SymbolGraph, SymbolNode, SymbolKind } from "../types";

interface GraphifyNode {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  metadata?: { language?: string; kind?: string } | null;
}
interface GraphifyLink {
  source: string;
  target: string;
  relation: string;
  confidence?: string;
  source_file?: string;
  source_location?: string;
}
interface GraphifyGraph {
  nodes?: GraphifyNode[];
  links?: GraphifyLink[];
}

export interface GraphifyOptions {
  /** graphify binary (default: $GRAPHIFY_BIN or "graphify"). */
  bin?: string;
  /** Re-extract even if graphify-out/graph.json already exists. */
  refresh?: boolean;
  /** Drop INFERRED/AMBIGUOUS edges, keeping only deterministic tree-sitter edges. Default true. */
  extractedOnly?: boolean;
}

/** Relations that mean "A invokes B" — become SymbolNode.callees. */
const CALL_RELATIONS = new Set(["calls", "method"]);
/** Relations that mean "B is consumed by another module" — proxy for `exported`. */
const EXPORT_RELATIONS = new Set(["imports", "imports_from", "re_exports"]);

// LLM provider keys that graphify's *semantic* (doc/image) extraction could read. We only ever run
// graphify's code-only / no-label steps, but we still strip these from its environment so the tool
// physically cannot reach a paid API — enforcing the "no key outside the user's own sub" rule.
const LLM_KEY_VARS = [
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS", "DEEPSEEK_API_KEY", "AZURE_OPENAI_API_KEY",
  "OPENROUTER_API_KEY", "COHERE_API_KEY", "MISTRAL_API_KEY",
];

/** A copy of the environment with every known LLM API-key variable removed. */
export function llmFreeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of LLM_KEY_VARS) delete env[k];
  return env;
}

export function indexRepoViaGraphify(repoRoot: string, opts: GraphifyOptions = {}): SymbolGraph {
  const root = path.resolve(repoRoot);
  const notes: string[] = [];
  const extractedOnly = opts.extractedOnly !== false;

  const graphPath = ensureGraph(root, opts, notes);
  const raw = JSON.parse(fs.readFileSync(graphPath, "utf8")) as GraphifyGraph;
  const gNodes = raw.nodes ?? [];
  // Determinism filter: keep ONLY edges graphify tagged EXTRACTED (tree-sitter). A missing/unknown
  // confidence is EXCLUDED, not trusted — this is a safety gate, so schema drift must fail closed.
  const links = (raw.links ?? []).filter((l) => !extractedOnly || l.confidence === "EXTRACTED");

  const byGid = new Map<string, GraphifyNode>();
  for (const n of gNodes) byGid.set(n.id, n);

  // A node is a "symbol" (interview target) if it is an endpoint of a call edge. Files,
  // JSON keys, and doc headings are containers, not functions — they never call or get called.
  const symbolGids = new Set<string>();
  for (const l of links) {
    if (CALL_RELATIONS.has(l.relation)) {
      symbolGids.add(l.source);
      symbolGids.add(l.target);
    }
  }

  // `exported` proxy: target of an import/re-export, OR called from a different file.
  const exportedGids = new Set<string>();
  for (const l of links) {
    if (EXPORT_RELATIONS.has(l.relation)) exportedGids.add(l.target);
    if (CALL_RELATIONS.has(l.relation)) {
      const src = byGid.get(l.source);
      const tgt = byGid.get(l.target);
      if (src && tgt && src.source_file && tgt.source_file && src.source_file !== tgt.source_file) {
        exportedGids.add(l.target);
      }
    }
  }

  // gid -> our stable id (`<relfile>#<name>:<line>`). We REBUILD the id from file+name+line and
  // never reuse graphify's own id, which is an absolute-path slug (leaks $HOME, not portable).
  const gidToId = new Map<string, string>();
  const nodes = new Map<string, SymbolNode>();
  let skipped = 0;

  for (const gid of symbolGids) {
    const gn = byGid.get(gid);
    if (!gn || gn.source_file == null || gn.source_location == null) {
      skipped++;
      continue;
    }
    const { line, endLine } = parseLoc(gn.source_location);
    const rel = gn.source_file;
    const name = symbolName(gn.label || gid);
    const id = `${rel}#${name}:${line}`;
    gidToId.set(gid, id);
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      name,
      kind: kindOf(gn.metadata?.kind),
      file: rel,
      line,
      endLine,
      exported: exportedGids.has(gid),
      params: [],
      returnType: undefined,
      branchCount: 0,
      callees: [],
      loc: Math.max(1, endLine - line + 1),
    });
  }

  // Attach call edges (now that every endpoint has an id).
  for (const l of links) {
    if (!CALL_RELATIONS.has(l.relation)) continue;
    const fromId = gidToId.get(l.source);
    const toId = gidToId.get(l.target);
    if (!fromId || !toId || fromId === toId) continue;
    const sym = nodes.get(fromId);
    if (sym && !sym.callees.includes(toId)) sym.callees.push(toId);
  }

  const inDegree: Record<string, number> = {};
  for (const sym of nodes.values()) {
    for (const c of sym.callees) inDegree[c] = (inDegree[c] || 0) + 1;
  }

  notes.push(
    `graphify substrate: ${nodes.size} symbol node(s) from ${gNodes.length} graph node(s)` +
      (skipped ? `, skipped ${skipped} without file/line` : "") +
      `. Body facts (params, branch count, declaration span) are not carried by graph.json and are ` +
      `approximated — null-param and control-flow questions are weaker than the TS-compiler substrate.`,
  );

  return { repo: root, nodes: [...nodes.values()], inDegree, notes };
}

/** graphify labels a function `main()` / `Cls.method()`; ts-compiler keys on the bare name. */
function symbolName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}

/** "L53" -> {line:53,endLine:53}; "L12-L40" -> {line:12,endLine:40}. */
function parseLoc(loc: string): { line: number; endLine: number } {
  const m = /L(\d+)(?:\s*-\s*L?(\d+))?/.exec(loc);
  if (!m) return { line: 1, endLine: 1 };
  const line = parseInt(m[1], 10);
  const endLine = m[2] ? parseInt(m[2], 10) : line;
  return { line, endLine: Math.max(line, endLine) };
}

function kindOf(kind?: string): SymbolKind {
  if (kind === "method") return "method";
  if (kind === "arrow" || kind === "arrow_function") return "arrow";
  return "function";
}

/** Run graphify if no graph.json is present (or refresh requested); return the graph.json path. */
function ensureGraph(root: string, opts: GraphifyOptions, notes: string[]): string {
  const graphPath = path.join(root, "graphify-out", "graph.json");
  if (!opts.refresh && fs.existsSync(graphPath)) {
    notes.push("reused existing graphify-out/graph.json (pass refresh:true to re-extract).");
    return graphPath;
  }
  const bin = opts.bin || process.env.GRAPHIFY_BIN || "graphify";
  try {
    execFileSync(bin, ["update", root, "--no-cluster", "--force"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
      env: llmFreeEnv(), // graphify cannot see an LLM key — code extraction is local tree-sitter
    });
  } catch (e) {
    throw new Error(
      `graphify extraction failed (bin: ${bin}). Install it with \`pip install graphifyy\` ` +
        `or set GRAPHIFY_BIN. Underlying error: ${(e as Error).message}`,
    );
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graphify ran but no graph.json at ${graphPath}`);
  }
  return graphPath;
}
