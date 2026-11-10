/**
 * A small seeded PRNG (mulberry32): the same numbers for the same seed, on
 * the server and in the browser. For decoration laid out at random but
 * identically on every render (the starfield, the agent animation's dots).
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
