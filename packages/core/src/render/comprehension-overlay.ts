// comprehension-overlay: paint a graphify-generated Obsidian vault by how well you understand
// each function. We do NOT build the vault (graphify owns that — safe filenames, communities,
// canvas, graph.json). We OVERLAY: set a `dk/<bucket>` tag in each scored function note's YAML
// frontmatter and prepend matching colorGroups to graphify's .obsidian/graph.json so the graph
// view recolors by comprehension. This replaces the old hand-rolled render/obsidian.ts.
//
// We touch ONLY the YAML frontmatter block (between the leading `---` fences) — never the note
// body. An earlier version edited the body's inline `#tag` line too; that could corrupt notes
// whose body contains a `tags:` line or a `#dk/...` string (e.g. doc-derived notes, code
// excerpts). Obsidian colors a node from its frontmatter `tags:`, so the frontmatter is all we
// need and the only safe thing to edit.
//
// JOIN: interview scores are keyed by ts-compiler id (`<file>#<name>:<line>`); graphify notes
// carry `source_file` (frontmatter) + a `# name()` title. The line number DRIFTS between the two
// extractors, so it can't be part of the key — we join on `<source_file>#<name>` (see joinKey).
// Residual limit: two functions with the same bare name in one file (overloads / shadowing) share
// a key, so they get the same bucket; we can't disambiguate them without a reliable shared line.

import * as fs from "fs";
import * as path from "path";
import { Dimension } from "../types";

export interface SymbolScore {
  score: number;
  self?: number;
  dimensions?: Partial<Record<Dimension, number>>;
}

// Comprehension buckets — same colors/thresholds the old obsidian.ts used (Obsidian wants rgb as a
// packed int). Ordered high→low so bucketFor can short-circuit.
const BUCKETS = [
  { tag: "dk/understood", emoji: "🟢", label: "understood (4-5)", rgb: 5025616, min: 4 },
  { tag: "dk/shaky", emoji: "🟠", label: "shaky (2-3)", rgb: 16750592, min: 2 },
  { tag: "dk/blackbox", emoji: "🔴", label: "black box (0-1)", rgb: 15022389, min: 0 },
];
const UNTESTED = { tag: "dk/untested", emoji: "⚪", label: "not yet tested", rgb: 10395294 };
const ALL_DK_TAGS = [...BUCKETS.map((b) => b.tag), UNTESTED.tag];

function bucketFor(score?: number): { tag: string; rgb: number } {
  if (score === undefined || !Number.isFinite(score)) return UNTESTED;
  return BUCKETS.find((b) => score >= b.min) ?? BUCKETS[BUCKETS.length - 1];
}

/** The stable cross-extractor join key: source file + symbol name (NOT line — it drifts). */
export function joinKey(file: string, name: string): string {
  return `${file}#${stripParens(name)}`;
}

export interface OverlayOptions {
  /** Tag function notes that have no score as dk/untested (default true). */
  tagUntested?: boolean;
}

export interface OverlayResult {
  /** function notes that matched a score and got a dk/<bucket> tag. */
  tagged: number;
  /** function notes tagged dk/untested. */
  untested: number;
  /** scores that matched no note in the vault (renamed/missing). */
  unmatched: string[];
  /** colorGroups written into .obsidian/graph.json (our dk groups; community groups kept after). */
  colorGroups: number;
  notes: string[];
}

/**
 * Overlay comprehension onto a graphify vault at `vaultDir`. `scores` is keyed by joinKey(file,name).
 * Idempotent: re-running re-derives all dk tags + colorGroups from scratch.
 */
export function overlayComprehension(
  vaultDir: string,
  scores: Record<string, SymbolScore>,
  opts: OverlayOptions = {},
): OverlayResult {
  const tagUntested = opts.tagUntested !== false;
  const notes: string[] = [];
  const matched = new Set<string>();
  let tagged = 0;
  let untested = 0;

  for (const full of walkMarkdown(vaultDir)) {
    const raw = fs.readFileSync(full, "utf8");
    const fm = splitFrontmatter(raw);
    if (!fm) continue; // not a graphify note (no YAML frontmatter)
    const meta = noteMeta(fm.front, fm.body);
    // Only FUNCTION notes get a comprehension color. graphify titles functions `name()`; files,
    // interfaces, and config keys have no parens and are left untouched.
    if (!meta.isFunction || !meta.sourceFile) continue;

    const key = joinKey(meta.sourceFile, meta.name);
    const has = Object.prototype.hasOwnProperty.call(scores, key);
    if (!has && !tagUntested) continue;

    const bucket = bucketFor(has ? scores[key].score : undefined);
    const newRaw = `---\n${setDkTag(fm.front, bucket.tag)}\n---\n${fm.body}`;
    if (newRaw !== raw) fs.writeFileSync(full, newRaw, "utf8");
    if (has) {
      matched.add(key);
      tagged++;
    } else {
      untested++;
    }
  }

  const unmatched = Object.keys(scores).filter((k) => !matched.has(k));
  const colorGroups = mergeColorGroups(vaultDir, notes);

  notes.push(
    `overlay: ${tagged} scored function note(s) colored` +
      (tagUntested ? `, ${untested} tagged untested` : "") +
      (unmatched.length ? `, ${unmatched.length} score(s) matched no note` : "") +
      `, ${colorGroups} comprehension colorGroup(s) written.`,
  );
  return { tagged, untested, unmatched, colorGroups, notes };
}

interface NoteMeta {
  sourceFile?: string;
  name: string;
  isFunction: boolean;
}

/** Pull source_file (frontmatter) + title name (`# name()`, body) from a graphify note. */
function noteMeta(front: string, body: string): NoteMeta {
  const sf = /^source_file:\s*"?([^"\n]+?)"?\s*$/m.exec(front);
  const title = /^#\s+(.+?)\s*$/m.exec(body);
  const rawName = title ? title[1].trim() : "";
  return {
    sourceFile: sf ? sf[1].trim() : undefined,
    name: stripParens(rawName),
    isFunction: /\([^)]*\)\s*$/.test(rawName),
  };
}

/** Split `---\n<front>\n---\n<body>` → {front, body}; null if there's no leading frontmatter. */
function splitFrontmatter(raw: string): { front: string; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  return m ? { front: m[1], body: m[2] } : null;
}

/** Set the single dk tag inside a YAML frontmatter string. Idempotent: strips any prior dk tag. */
function setDkTag(front: string, tag: string): string {
  let f = stripDkTags(front);
  // block style:  tags:\n  - a\n  - b
  if (/^tags:[ \t]*$/m.test(f)) {
    return f.replace(/^(tags:[ \t]*\n)((?:[ \t]*-[ \t]*.*\n?)*)/m, (_m, head, items) => {
      const block = items && !items.endsWith("\n") ? items + "\n" : items;
      return `${head}${block}  - ${tag}\n`;
    });
  }
  // flow style:  tags: [a, b]
  if (/^tags:[ \t]*\[/m.test(f)) {
    return f.replace(/^(tags:[ \t]*\[)([^\]]*)(\])/m, (_m, h, inner, close) => {
      const body = inner.trim() ? `${inner.trim()}, ` : "";
      return `${h}${body}${tag}${close}`;
    });
  }
  // no tags key at all: append a block list to the frontmatter.
  return `${f.endsWith("\n") || f === "" ? f : f + "\n"}tags:\n  - ${tag}\n`;
}

/** Remove any previously-written dk tag (block item or flow member) from a frontmatter string. */
function stripDkTags(front: string): string {
  let f = front;
  for (const t of ALL_DK_TAGS) {
    const e = escapeRe(t);
    f = f.replace(new RegExp(`^[ \\t]*-[ \\t]*${e}[ \\t]*\\n?`, "gm"), ""); // block item
    f = f.replace(new RegExp(`(tags:[ \\t]*\\[[^\\]]*?)[, ]*${e}`, "g"), "$1"); // flow member
    f = f.replace(/^(tags:[ \t]*\[)[, ]+/m, "$1"); // tidy a leftover leading comma
  }
  return f;
}

/**
 * Prepend dk comprehension colorGroups to graphify's graph.json (community groups kept after).
 * Obsidian evaluates colorGroups top-down and a node takes the FIRST query it matches, so dk
 * groups placed first win over the community color on any scored node.
 */
function mergeColorGroups(vaultDir: string, notes: string[]): number {
  const gjPath = path.join(vaultDir, ".obsidian", "graph.json");
  let config: { colorGroups?: { query: string; color: { a: number; rgb: number } }[] } = {};
  if (fs.existsSync(gjPath)) {
    try {
      config = JSON.parse(fs.readFileSync(gjPath, "utf8"));
    } catch {
      notes.push("existing .obsidian/graph.json was unparseable; rewriting it.");
    }
  } else {
    fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
  }
  const dkGroups = [...BUCKETS, UNTESTED].map((b) => ({
    query: `tag:#${b.tag}`,
    color: { a: 1, rgb: b.rgb },
  }));
  const dkQueries = new Set(dkGroups.map((g) => g.query));
  const kept = (config.colorGroups ?? []).filter((g) => !dkQueries.has(g.query));
  config.colorGroups = [...dkGroups, ...kept]; // dk first → wins over community color on scored nodes
  fs.writeFileSync(gjPath, JSON.stringify(config, null, 2), "utf8");
  return dkGroups.length;
}

/** Every .md note under the vault (recursive), skipping `.obsidian/` and the `_COMMUNITY_` notes. */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // skip .obsidian and dotfiles
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(full));
    else if (e.name.endsWith(".md") && !e.name.startsWith("_COMMUNITY_")) out.push(full);
  }
  return out;
}

function stripParens(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
