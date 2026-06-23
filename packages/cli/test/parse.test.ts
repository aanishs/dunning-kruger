import { describe, it, expect } from "vitest";
import { parseRatings } from "../src/parse";

describe("parseRatings (no rating-shift, the audit bug)", () => {
  it("keeps positions when a slot is EMPTY — 5,,1 stays [5,3,1]", () => {
    expect(parseRatings("5,,1", 3)).toEqual([5, 3, 1]);
  });
  it("keeps positions when a slot is INVALID — 5,x,1 stays [5,3,1]", () => {
    expect(parseRatings("5,x,1", 3)).toEqual([5, 3, 1]);
  });
  it("accepts space-separated input", () => {
    expect(parseRatings("5 4 3", 3)).toEqual([5, 4, 3]);
  });
  it("clamps to 1..5 and defaults missing slots to 3", () => {
    expect(parseRatings("9,0,3", 3)).toEqual([5, 1, 3]);
    expect(parseRatings("5", 3)).toEqual([5, 3, 3]);
  });
  it("does not parse a digit-prefixed junk token like 5x as 5", () => {
    expect(parseRatings("5x,4,3", 3)).toEqual([3, 4, 3]);
  });
});
