// ============================================================
// Deterministic description similarity — no AI, no RNG.
// Uses max(tokenJaccard, trigramJaccard):
//   - tokenJaccard: good for identical or closely worded descriptions
//   - trigramJaccard: better for partial-word overlaps and shared substrings
// Both metrics return values in [0, 1].
// ============================================================

/** Jaccard index over two sets: |A ∩ B| / |A ∪ B|. */
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1; // two empty strings are identical
  const intersection = [...a].filter((x) => b.has(x));
  return intersection.length / (a.size + b.size - intersection.length);
}

/** Split a normalized string into word tokens, drop empties. */
function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

/**
 * All 3-character substrings of the string (with double-space padding
 * so leading/trailing characters get full coverage).
 */
function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `;
  const result = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Similarity score between two already-normalized description strings.
 * Returns a value in [0, 1].  Fully deterministic — same inputs, same output.
 */
export function descriptionSimilarity(normA: string, normB: string): number {
  const tokenScore = jaccard(tokens(normA), tokens(normB));
  const trigramScore = jaccard(trigrams(normA), trigrams(normB));
  return Math.max(tokenScore, trigramScore);
}
