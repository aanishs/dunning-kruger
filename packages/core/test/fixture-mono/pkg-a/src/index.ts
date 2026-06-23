// pkg-a imports pkg-b through the tsconfig `@b/*` path alias — the edge a glob-only
// fallback would miss. The references-following indexer must still see fromA -> fromB.
import { fromB } from "@b/index";

export function fromA(x: number): number {
  return fromB(x) + 1;
}
