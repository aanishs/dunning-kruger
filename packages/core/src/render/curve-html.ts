// renderCurveHtml: the shareable artifact — a self-contained HTML page with an inline SVG
// calibration plot. Pure (string in, string out), zero dependencies. Honest by construction:
// it plots confidence vs. competence with a perfect-calibration diagonal. It does NOT draw
// the "Mount Stupid" curve (that's a meme, not from the paper).

export interface CurvePoint {
  name: string;
  /** 0-100 */
  selfPct: number;
  /** 0-100 */
  measuredPct: number;
}

export interface CurveData {
  title: string;
  date: string;
  selfPct: number;
  measuredPct: number;
  gap: number;
  zone: string;
  points: CurvePoint[];
}

export function renderCurveHtml(d: CurveData): string {
  const W = 420;
  const M = 44; // margin
  const P = W - M * 2; // plot size
  // x = competence (measured), y = confidence (self), y inverted so "more confident" is up.
  const px = (measured: number) => M + (clamp(measured) / 100) * P;
  const py = (self: number) => M + P - (clamp(self) / 100) * P;

  const dots = d.points
    .map(
      (p) =>
        `<circle cx="${px(p.measuredPct).toFixed(1)}" cy="${py(p.selfPct).toFixed(1)}" r="4" class="dot"><title>${esc(p.name)}: felt ${pct(p.selfPct)}%, showed ${pct(p.measuredPct)}%</title></circle>`,
    )
    .join("\n");

  const ox = px(d.measuredPct);
  const oy = py(d.selfPct);

  const self = pct(d.selfPct);
  const measured = pct(d.measuredPct);
  const gap = Number.isFinite(d.gap) ? Math.round(Math.max(-100, Math.min(100, d.gap))) : 0;
  const gapLabel = `${gap > 0 ? "+" : ""}${gap}%`;
  const caption =
    gap >= 25
      ? "You rated yourself above what you could show. That gap is where the learning is, not a knock."
      : gap <= -10
        ? "You sold yourself short — you understand this better than you gave yourself credit for."
        : "Confidence and competence are roughly in step. Run it again as the code changes.";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)} — calibration</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; background:#0f1115; color:#e7e9ee; font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .card { max-width:480px; margin:32px auto; background:#171a21; border:1px solid #262b36; border-radius:14px; padding:24px 26px; }
  h1 { font-size:17px; margin:0 0 2px; letter-spacing:.2px; }
  .sub { color:#8b93a3; font-size:13px; margin:0 0 18px; }
  .nums { display:flex; gap:22px; margin:6px 0 4px; }
  .nums b { font-size:26px; font-weight:650; }
  .nums span { display:block; color:#8b93a3; font-size:12px; }
  .gap { font-size:15px; margin:10px 0 2px; }
  .zone { color:#9aa3b2; font-size:13px; margin:0 0 14px; }
  .cap { color:#aeb6c4; font-size:13px; border-top:1px solid #262b36; padding-top:12px; margin-top:14px; }
  .foot { color:#6b7280; font-size:11px; margin-top:10px; }
  svg { display:block; margin:8px 0 4px; }
  .axis { stroke:#2b313c; stroke-width:1; }
  .diag { stroke:#3b4250; stroke-width:1.5; stroke-dasharray:4 4; }
  .dot { fill:#7aa2ff; opacity:.85; }
  .you { fill:#ff8a4c; stroke:#0f1115; stroke-width:2; }
  .lab { fill:#6b7280; font-size:10px; }
</style></head>
<body><div class="card">
  <h1>${esc(d.title)}</h1>
  <p class="sub">how well you understand your own code</p>
  <div class="nums">
    <div><b>${self}%</b><span>confidence (what you felt)</span></div>
    <div><b>${measured}%</b><span>competence (what you showed)</span></div>
  </div>
  <div class="gap">gap: <b>${gapLabel}</b></div>
  <div class="zone">${esc(d.zone)}</div>
  <svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" role="img" aria-label="calibration plot">
    <line class="axis" x1="${M}" y1="${M + P}" x2="${M + P}" y2="${M + P}"/>
    <line class="axis" x1="${M}" y1="${M}" x2="${M}" y2="${M + P}"/>
    <line class="diag" x1="${M}" y1="${M + P}" x2="${M + P}" y2="${M}"><title>perfect calibration</title></line>
    <text class="lab" x="${M + P}" y="${M + P + 16}" text-anchor="end">competence →</text>
    <text class="lab" x="${M - 8}" y="${M + 4}" text-anchor="end" transform="rotate(-90 ${M - 8} ${M + 4})">confidence →</text>
    ${dots}
    <circle class="you" cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="7"><title>you: felt ${self}%, showed ${measured}%</title></circle>
  </svg>
  <p class="cap">${esc(caption)}</p>
  <p class="foot">One session is a single calibration point, not a curve. The "Mount Stupid" curve isn't in Kruger &amp; Dunning's paper. ${esc(d.date)}</p>
</div></body></html>`;
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
/** Display-safe percent: clamped to 0-100 and rounded, so a NaN/Infinity never renders as text. */
function pct(n: number): number {
  return Math.round(clamp(n));
}
function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
