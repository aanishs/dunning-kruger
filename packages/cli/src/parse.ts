// Pure, testable input parsing for the CLI (no side effects, safe to import in tests).

export function parseRatings(line: string, count: number): number[] {
  // Positional: token i maps to target i. Preserve EMPTY slots so a blank or invalid entry
  // defaults in place (3) instead of shifting later ratings onto the wrong target.
  // "5,,1" must stay [5,3,1], not [5,1]. Commas keep slots; whitespace-only input splits
  // on spaces. Values clamp to 1..5.
  const parts = line.includes(",") ? line.split(",") : line.trim().split(/\s+/);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const raw = (parts[i] ?? "").trim();
    // strict: "5x" must NOT parse to 5. Only a clean integer counts; else default to 3.
    const v = /^-?\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    out.push(Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 3);
  }
  return out;
}
