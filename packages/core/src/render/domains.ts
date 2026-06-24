// domains: put human names on a graphify vault's numbered communities.
//
// `dk vault` clusters the graph but leaves communities NUMBERED ("Community 0" .. "Community N") —
// graphify's semantic naming is its LLM step, skipped (--no-label) to stay key-free. Naming a
// cluster is a judgment call, so the in-session model does it and hands us a mapping; THIS applies
// it deterministically across every place a community id appears: note frontmatter, the
// `community/<id>` tags (frontmatter list + inline hashtag), the `_COMMUNITY_<id>` index notes
// (content + filename), the graph.canvas group labels, and the .obsidian/graph.json colorGroup
// queries. Model = judgment, code = the mechanical rewrite.
//
// The mapping comes from an LLM, so it is UNTRUSTED: we validate it up front (every value a
// non-empty string with no YAML-breaking chars, and no two communities collapsing to the same
// display / tag / filename) and use replacement CALLBACKS so a `$1` or `$&` in a name can never be
// reinterpreted as a backreference.

import * as fs from "fs";
import * as path from "path";

export interface RenameResult {
  /** communities whose id matched at least one place in the vault. */
  renamed: number;
  /** .md notes whose content was rewritten. */
  notesTouched: number;
  /** _COMMUNITY_ index notes whose file was renamed. */
  indexNotesRenamed: number;
  canvasUpdated: boolean;
  graphJsonUpdated: boolean;
  /** mapping keys that matched nothing in the vault (stale / already renamed). */
  unmatched: string[];
  notes: string[];
}

interface Op {
  oldDisplay: string; // "Community 6"
  newDisplay: string; // "Auth"
  oldTag: string;     // "community/Community_6"
  newTag: string;     // "community/Auth"
  newFile: string;    // filesystem-safe name for _COMMUNITY_<newFile>.md
  matched: boolean;
}

/** Reject names that would break double-quoted YAML or paths: quotes, newlines, control chars. */
const UNSAFE_NAME = new RegExp('["\\u0000-\\u001f]');
const UNSAFE_FILE = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]', "g");

/**
 * Rename a graphify vault's communities. `mapping` is keyed by the community's CURRENT display name
 * (e.g. `{ "Community 6": "Auth" }`). Deterministic and order-independent. Throws on an invalid
 * mapping (non-string/empty/unsafe values, or two communities that would collide).
 */
export function renameDomains(vaultDir: string, mapping: Record<string, unknown>): RenameResult {
  const ops = validateMapping(mapping);
  const result: RenameResult = {
    renamed: 0, notesTouched: 0, indexNotesRenamed: 0,
    canvasUpdated: false, graphJsonUpdated: false, unmatched: [], notes: [],
  };

  // --- notes (content rewrite, then rename _COMMUNITY_ files) ---
  for (const full of walkMarkdown(vaultDir)) {
    const before = fs.readFileSync(full, "utf8");
    let raw = before;
    for (const op of ops) {
      const next = applyToNote(raw, op);
      if (next !== raw) { raw = next; op.matched = true; }
    }
    if (raw !== before) { fs.writeFileSync(full, raw, "utf8"); result.notesTouched++; }

    // rename the index note file: _COMMUNITY_Community 6.md -> _COMMUNITY_Auth.md
    const base = path.basename(full);
    for (const op of ops) {
      if (base !== `_COMMUNITY_${op.oldDisplay}.md`) continue;
      const dest = path.join(path.dirname(full), `_COMMUNITY_${op.newFile}.md`);
      if (dest === full) { op.matched = true; break; }
      if (fs.existsSync(dest)) { result.notes.push(`did not rename ${base}: ${path.basename(dest)} already exists`); break; }
      fs.renameSync(full, dest); result.indexNotesRenamed++; op.matched = true; break;
    }
  }

  // --- graph.canvas group labels ---
  const canvasPath = path.join(vaultDir, "graph.canvas");
  if (fs.existsSync(canvasPath)) {
    try {
      const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
      let touched = false;
      for (const node of canvas.nodes ?? []) {
        if (node.type === "group" && typeof node.label === "string") {
          const op = ops.find((o) => o.oldDisplay === node.label);
          if (op) { node.label = op.newDisplay; touched = true; op.matched = true; }
        }
      }
      if (touched) { fs.writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), "utf8"); result.canvasUpdated = true; }
    } catch { result.notes.push("graph.canvas was unparseable; left as-is."); }
  }

  // --- .obsidian/graph.json colorGroup queries ---
  const gjPath = path.join(vaultDir, ".obsidian", "graph.json");
  if (fs.existsSync(gjPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(gjPath, "utf8"));
      let touched = false;
      for (const g of cfg.colorGroups ?? []) {
        const op = ops.find((o) => g.query === `tag:#${o.oldTag}`);
        if (op) { g.query = `tag:#${op.newTag}`; touched = true; op.matched = true; }
      }
      if (touched) { fs.writeFileSync(gjPath, JSON.stringify(cfg, null, 2), "utf8"); result.graphJsonUpdated = true; }
    } catch { result.notes.push(".obsidian/graph.json was unparseable; left as-is."); }
  }

  result.renamed = ops.filter((o) => o.matched).length;
  result.unmatched = ops.filter((o) => !o.matched).map((o) => o.oldDisplay);
  result.notes.push(
    `named ${result.renamed} domain(s): ${result.notesTouched} note(s), ${result.indexNotesRenamed} index note(s)` +
      `, canvas ${result.canvasUpdated ? "updated" : "unchanged"}, graph.json ${result.graphJsonUpdated ? "updated" : "unchanged"}` +
      (result.unmatched.length ? `; ${result.unmatched.length} mapping key(s) matched nothing` : ""),
  );
  return result;
}

/** Rewrite one community id inside one note. Callbacks keep `$` in names literal; tag edits are
 *  scoped to YAML list items and inline `#` hashtags so prose/code mentions are never touched. */
function applyToNote(raw: string, op: Op): string {
  let r = raw;
  // frontmatter `community: "Community 6"` — closing quote anchors it (6 vs 60)
  r = r.replace(new RegExp(`(^community:[ \\t]*")${escapeRe(op.oldDisplay)}(")`, "m"), (_m, a, b) => `${a}${op.newDisplay}${b}`);
  // frontmatter tag list item `  - community/Community_6`
  r = r.replace(new RegExp(`(^[ \\t]*-[ \\t]*)${escapeRe(op.oldTag)}(?![A-Za-z0-9_/-])`, "gm"), (_m, a) => `${a}${op.newTag}`);
  // inline hashtag `#community/Community_6`
  r = r.replace(new RegExp(`(#)${escapeRe(op.oldTag)}(?![A-Za-z0-9_/-])`, "g"), (_m, a) => `${a}${op.newTag}`);
  // _COMMUNITY_ index heading `# Community 6` (end-anchored)
  r = r.replace(new RegExp(`(^#[ \\t]+)${escapeRe(op.oldDisplay)}[ \\t]*$`, "m"), (_m, a) => `${a}${op.newDisplay}`);
  return r;
}

/** Validate the (untrusted, LLM-produced) mapping and build the rename ops, or throw with reasons. */
function validateMapping(mapping: Record<string, unknown>): Op[] {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error('domain mapping must be a JSON object like {"Community 6":"Auth"}.');
  }
  const errors: string[] = [];
  const ops: Op[] = [];
  const byDisplay = new Map<string, string>();
  const byTag = new Map<string, string>();
  const byFile = new Map<string, string>();
  for (const [oldDisplay, rawNew] of Object.entries(mapping)) {
    if (typeof rawNew !== "string") { errors.push(`"${oldDisplay}": name must be a string`); continue; }
    if (UNSAFE_NAME.test(rawNew)) { errors.push(`"${oldDisplay}": name can't contain quotes, newlines, or control characters`); continue; }
    const newDisplay = rawNew.trim();
    if (!newDisplay) { errors.push(`"${oldDisplay}": name is empty`); continue; }
    const newTag = `community/${tagSlug(newDisplay)}`;
    const newFile = fileSafe(newDisplay);
    if (byDisplay.has(newDisplay)) errors.push(`two communities map to the same name "${newDisplay}"`);
    else if (byTag.has(newTag)) errors.push(`"${byTag.get(newTag)}" and "${newDisplay}" collapse to the same tag ${newTag}`);
    else if (byFile.has(newFile)) errors.push(`"${byFile.get(newFile)}" and "${newDisplay}" collapse to the same file _COMMUNITY_${newFile}.md`);
    byDisplay.set(newDisplay, newDisplay); byTag.set(newTag, newDisplay); byFile.set(newFile, newDisplay);
    ops.push({
      oldDisplay: oldDisplay.trim(),
      newDisplay,
      oldTag: `community/${oldDisplay.trim().replace(/\s+/g, "_")}`,
      newTag, newFile, matched: false,
    });
  }
  if (errors.length) throw new Error("invalid domain mapping:\n  - " + errors.join("\n  - "));
  return ops;
}

/** Obsidian tags allow letters, digits, _, -, and / (nesting). Collapse the rest; trim edges. */
function tagSlug(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_/-]+/g, "_").replace(/\/{2,}/g, "/").replace(/^[_/-]+|[_/-]+$/g, "") || "domain";
}

/** Filesystem-safe community name for the _COMMUNITY_ note filename (spaces are fine, as graphify does). */
function fileSafe(name: string): string {
  return name.replace(UNSAFE_FILE, "_").replace(/[. ]+$/, "").trim() || "domain";
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
