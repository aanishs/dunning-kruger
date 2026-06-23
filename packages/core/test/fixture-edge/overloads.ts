// Overload signatures (bodiless) + a nested local — the two substrate bugs the audit found.

export function pick(x: number): number;
export function pick(x: string): string;
export function pick(x: number | string): number | string {
  if (typeof x === "number") return x + 1;
  return x.toUpperCase();
}

export function outer(n: number): number {
  // nested local — must NOT be reported as exported just because `outer` is
  function innerHelper(y: number): number {
    return y > 0 ? y * 2 : 0;
  }
  return innerHelper(n) + n;
}

// exported by statement, not inline modifier — must still count as exported
function helper(n: number): number {
  return n < 0 ? 0 : n + 1;
}
export { helper };

// anonymous default export — must be indexed (as "default") and exported
export default function (x: number): number {
  return x > 0 ? x * 2 : x;
}

export class Svc {
  run(n: number): number {
    return n + 1; // public method of an exported class -> exported
  }
  private secret(n: number): number {
    return n - 1; // private -> NOT public API
  }
}
