// placeOnCurve: turn (self-rating, measured score) pairs into a Dunning-Kruger placement.
//
// self% = (selfRating - 1) / 4 * 100   (1-5 scale, floor at 1)
// measured% = score / 5 * 100          (0-5 scale, floor at 0)
// gap = self% - measured%              (positive = overconfident)
//
// At n=1 this is a single calibration point, not a population curve. The over-time view
// (from the overlay) is what traces the climb.

import { TargetResult, CurvePlacement } from "./types";

export function placeOnCurve(results: TargetResult[]): CurvePlacement {
  if (results.length === 0) {
    return { selfPct: 0, measuredPct: 0, gap: 0, zone: "no data" };
  }
  const selfPct = avg(results.map((r) => ((clampRating(r.selfRating) - 1) / 4) * 100));
  const measuredPct = avg(results.map((r) => (clamp05(r.score) / 5) * 100));
  const gap = round1(selfPct - measuredPct);
  return { selfPct: round1(selfPct), measuredPct: round1(measuredPct), gap, zone: zoneFor(measuredPct, gap) };
}

// Honest, human zone labels — NOT the "Mount Stupid / Valley of Despair" meme (that curve
// isn't in Kruger & Dunning's paper). These describe the calibration, not a cartoon journey.
function zoneFor(measuredPct: number, gap: number): string {
  if (gap >= 25 && measuredPct < 55) return "confidence ran ahead of competence";
  if (measuredPct < 40 && gap < 15) return "low, and you know it";
  if (gap <= 12 && measuredPct >= 70) return "calibrated and competent";
  if (measuredPct >= 50) return "climbing, gap closing";
  return "finding your level";
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function clampRating(r: number): number {
  return Number.isFinite(r) ? Math.max(1, Math.min(5, r)) : 1;
}
function clamp05(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.min(5, s)) : 0;
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
