// buildVault: emit the repo's call graph as an Obsidian vault — one markdown note per symbol,
// `[[wikilinks]]` for call edges, folders mirroring the repo (so Obsidian shows your DOMAINS as
// clusters), and a graph color-config that paints each node by how well you understand it.
//
// We render NOTHING ourselves: Obsidian's Graph view is the dashboard. This stays in the repo's
// "emit a static artifact, no server/JS" lane (same as render/curve-html.ts). Pure: data in,
// files out. The CLI reads the overlay + source spans and writes what this returns to disk.

import { SymbolGraph, Dimension } from "../types";

export interface VaultFile {
  /** vault-relative path, e.g. "src/billing/invoice/createInvoice.md". */
  path: string;
  content: string;
}

export interface SymbolScore {
  /** Your latest measured comprehension, 0-5. */
  score: number;
  /** Self-rating, 1-5, if captured. */
  self?: number;
  /** Per-facet 0-5 breakdown (semantic grader only). */
  dimensions?: Partial<Record<Dimension, number>>;
  question?: string;
  missed?: string[];
}

const DIMENSION_LABELS: Record<Dimension, string> = {
  mechanism: "mechanism",
  failureModes: "failure modes",
  blastRadius: "blast radius",
  rationale: "rationale",
};

export interface VaultOptions {
  /** Comprehension by SymbolNode.id (from an interview overlay). Absent → a structure-only vault. */
  scores?: Record<string, SymbolScore>;
  /** Source span text by SymbolNode.id, for the note body. */
  sources?: Record<string, string>;
  repoName?: string;
}

// Comprehension buckets — the tag drives Obsidian graph color groups (see graphConfig). rgb is
// the packed-int form Obsidian's graph.json wants. Ordered high→low so bucketFor can short-circuit.
const BUCKETS = [
  { tag: "dk/understood", emoji: "🟢", label: "understood (4-5)", rgb: 5025616, min: 4 },
  { tag: "dk/shaky", emoji: "🟠", label: "shaky (2-3)", rgb: 16750592, min: 2 },
  { tag: "dk/blackbox", emoji: "🔴", label: "black box (0-1)", rgb: 15022389, min: 0 },
];
const UNTESTED = { tag: "dk/untested", emoji: "⚪", label: "not yet tested", rgb: 10395294 };

function bucketFor(score?: number): { tag: string; emoji: string; label: string; rgb: number } {
  if (score === undefined || !Number.isFinite(score)) return UNTESTED;
  return BUCKETS.find((b) => score >= b.min) ?? BUCKETS[BUCKETS.length - 1];
}

export function buildVault(graph: SymbolGraph, opts: VaultOptions = {}): VaultFile[] {
  const { scores = {}, sources = {}, repoName } = opts;
  const files: VaultFile[] = [];

  // 1) A unique vault path per symbol, mirroring the repo dirs. The folder hierarchy IS the
  //    domain/feature structure Obsidian will cluster on.
  const pathOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const used = new Set<string>();
  for (const n of graph.nodes) {
    nameOf.set(n.id, n.name);
    const stem = `${n.file.replace(/\.[mc]?[jt]sx?$/, "")}/${safeName(n.name)}`;
    const p = used.has(stem) ? `${stem}-${n.line}` : stem; // collision (e.g. same name twice in a file)
    used.add(p);
    pathOf.set(n.id, p);
  }

  // caller counts (for the note header + an honest "see Backlinks" pointer)
  const callerCount = new Map<string, number>();
  for (const n of graph.nodes) {
    for (const c of n.callees) callerCount.set(c, (callerCount.get(c) ?? 0) + 1);
  }

  for (const n of graph.nodes) {
    const sc = scores[n.id];
    const bucket = bucketFor(sc?.score);
    const calls = n.callees
      .map((id) => (pathOf.has(id) ? `- [[${pathOf.get(id)}|${nameOf.get(id)}]]` : null))
      .filter(Boolean) as string[];

    const fm = [
      "---",
      `file: "${n.file}:${n.line}"`,
      `kind: ${n.kind}`,
      `exported: ${n.exported}`,
      `callers: ${callerCount.get(n.id) ?? 0}`,
      `callees: ${n.callees.length}`,
      ...(sc ? [`comprehension: ${sc.score}`] : []),
      ...(sc?.self !== undefined ? [`self_rating: ${sc.self}`] : []),
      `tags: [${bucket.tag}]`,
      "---",
    ].join("\n");

    const body: string[] = [
      `# ${n.name}`,
      "",
      `\`${n.file}:${n.line}\` · ${n.kind}${n.exported ? " · exported" : ""} · ${bucket.emoji} ${bucket.label}`,
      "",
    ];
    if (sc) {
      body.push("## Your comprehension", "");
      const felt = sc.self !== undefined ? `you felt ${sc.self}/5, ` : "";
      body.push(`**${felt}you showed ${sc.score}/5 overall.**`, "");
      const dims = sc.dimensions ?? {};
      const facets = (Object.keys(DIMENSION_LABELS) as Dimension[])
        .filter((d) => dims[d] !== undefined)
        .map((d) => `- ${DIMENSION_LABELS[d]}: ${dims[d]}/5`);
      if (facets.length) body.push("", ...facets, "");
      if (sc.question) body.push(`> ${sc.question}`, "");
      if (sc.missed?.length) body.push(`Still to nail: ${sc.missed.join("; ")}`, "");
      body.push("");
    }
    if (calls.length) body.push("## Calls", "", ...calls, "");
    const callers = callerCount.get(n.id) ?? 0;
    body.push(`_Called by ${callers} function${callers === 1 ? "" : "s"} — see the Backlinks panel._`, "");
    const src = sources[n.id];
    if (src) body.push("## Source", "", "```ts", src, "```", "");

    files.push({ path: `${pathOf.get(n.id)}.md`, content: `${fm}\n\n${body.join("\n")}` });
  }

  files.push({ path: "_Home.md", content: homeNote(graph, scores, repoName) });
  files.push({ path: ".obsidian/graph.json", content: graphConfig() });
  return files;
}

function homeNote(graph: SymbolGraph, scores: Record<string, SymbolScore>, repoName?: string): string {
  const domains = new Map<string, { total: number; tested: number; sum: number }>();
  for (const n of graph.nodes) {
    const d = domainKey(n.file);
    const e = domains.get(d) ?? { total: 0, tested: 0, sum: 0 };
    e.total++;
    const sc = scores[n.id];
    if (sc) {
      e.tested++;
      e.sum += sc.score;
    }
    domains.set(d, e);
  }
  const rows = [...domains.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([d, e]) => {
      const grade = e.tested ? `${(e.sum / e.tested).toFixed(1)}/5 over ${e.tested} tested` : "not tested yet";
      return `- **${d}** — ${e.total} function${e.total === 1 ? "" : "s"} · ${grade}`;
    });
  const testedTotal = Object.keys(scores).length;
  return [
    `# ${repoName ?? "repo"} — comprehension knowledge graph`,
    "",
    "Open the **Graph view** (`Cmd/Ctrl+G`). Each note is a function; every `[[link]]` is a call;",
    "the folders are your domains. Nodes are colored by how well you explained them in the interview.",
    "",
    testedTotal
      ? `**${testedTotal}** function${testedTotal === 1 ? "" : "s"} carry a comprehension score so far.`
      : "No interview scores yet — run `dk interview` and re-export to light up your black boxes.",
    "",
    "## Domains",
    "",
    ...rows,
    "",
    "## Legend",
    "",
    ...[...BUCKETS, UNTESTED].map((b) => `- ${b.emoji} ${b.label}`),
    "",
    "_Tip: in Graph view you can switch the color groups to `path:` queries to color by domain instead._",
    "",
  ].join("\n");
}

// Domain = the first 1-2 path segments (src/billing, packages/core, ...). Folders give Obsidian
// the finer hierarchy; this is just for the Home overview.
function domainKey(file: string): string {
  const d = file.split("/");
  if (d.length >= 3) return d.slice(0, 2).join("/");
  if (d.length === 2) return d[0];
  return "(root)";
}

// Obsidian graph color groups, keyed by the comprehension tags — so the graph is colored by
// understanding out of the box. Obsidian tolerates unknown fields, so this is safe to ship.
function graphConfig(): string {
  const colorGroups = [...BUCKETS, UNTESTED].map((b) => ({
    query: `tag:#${b.tag}`,
    color: { a: 1, rgb: b.rgb },
  }));
  return JSON.stringify({ colorGroups }, null, 2);
}

// Obsidian note names can't contain \ / : * ? " < > | # ^ [ ]. Identifiers are safe; be defensive.
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "_") || "_";
}
