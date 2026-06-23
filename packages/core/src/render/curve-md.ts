// renderReportMarkdown: dunning-kruger's OWN output is a plain markdown report — the calibration
// gap, a per-symbol table, and the reading list as a tick-off checklist. Renders anywhere (GitHub,
// any markdown viewer, or inside the graphify Obsidian vault). graphify owns the graph visuals;
// this owns the words. Pure: data in, string out. Replaces the hand-rolled HTML card.

import { Dimension } from "../types";

export interface ReportPoint {
  name: string;
  /** file:line */
  location: string;
  /** self rating, 1-5 */
  self: number;
  /** measured, 0-5 */
  measured: number;
  missed: string[];
  dimensions?: Partial<Record<Dimension, number>>;
}

export interface ReportData {
  title: string;
  date: string;
  selfPct: number;
  measuredPct: number;
  gap: number;
  zone: string;
  points: ReportPoint[];
}

const DIMENSION_LABELS: Record<string, string> = {
  mechanism: "mechanism",
  failureModes: "failure-modes",
  blastRadius: "blast-radius",
  rationale: "rationale",
};

export function renderReportMarkdown(d: ReportData): string {
  const out: string[] = [];
  out.push(`# ${d.title}`, "", `_${d.date}_`, "");

  out.push("## Where you landed", "");
  out.push(`- **confidence** (what you felt): ${d.selfPct}%`);
  out.push(`- **competence** (what you showed): ${d.measuredPct}%`);
  out.push(`- **gap:** ${d.gap > 0 ? "+" : ""}${d.gap}% · ${d.zone}`, "");
  out.push(gapSentence(d.gap), "");

  out.push("## By symbol", "");
  out.push("| symbol | you felt | you showed | facets |");
  out.push("| --- | --- | --- | --- |");
  for (const p of d.points) {
    const facets = formatDims(p.dimensions) || "—";
    out.push(`| \`${cell(p.name)}\`<br><sub>${cell(p.location)}</sub> | ${p.self}/5 | ${p.measured}/5 | ${cell(facets)} |`);
  }
  out.push("");

  // Reading list — weakest first, only items with something left to learn. A checklist so you can
  // tick each off as you can explain it cold; re-run `dk interview` and watch the gap close.
  const todo = [...d.points].filter((p) => p.missed.length > 0).sort((a, b) => a.measured - b.measured);
  out.push("## Reading list", "");
  if (todo.length === 0) {
    out.push("Nothing flagged — you covered what the code does. Worth knowing for sure rather than hoping.");
  } else {
    out.push("Start at the top (weakest). Tick each off as you can explain it from memory.", "");
    for (const p of todo) {
      out.push(`- [ ] \`${cell(p.name)}\` (${cell(p.location)}) — ${cell(p.missed.join("; "))}`);
    }
  }
  out.push("", "---", "<sub>One run is a single point, not a curve — run it again as you learn and watch the gap close.</sub>", "");
  return out.join("\n");
}

function gapSentence(gap: number): string {
  if (gap >= 25)
    return "You rated yourself well above what you could show just now. That's not a knock — it's the most useful result here, and exactly where the learning is.";
  if (gap <= -10)
    return "You sold yourself short — you understand this better than you gave yourself credit for.";
  return "Confidence and competence are roughly in line — a calibrated read of your own code.";
}

// Repo-controlled text (symbol names, missed-concept strings) goes into a markdown table and a
// checklist. Escape the pipe (table-column separator), collapse newlines, and neutralize raw HTML
// so a stray `|`, line break, or `<tag>` can't break the table or render markup.
function cell(s: string): string {
  return s.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

function formatDims(dims?: Partial<Record<Dimension, number>>): string {
  if (!dims) return "";
  return Object.entries(dims)
    .map(([k, v]) => `${DIMENSION_LABELS[k] ?? k} ${v}/5`)
    .join(" · ");
}
