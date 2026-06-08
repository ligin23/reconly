// ============================================================
// Text normalization — single swappable function.
// Uppercase, strip punctuation, collapse whitespace.
// ============================================================

/**
 * Normalizes a transaction description for comparison.
 * Swapping this function changes matching behavior globally.
 */
export function normalize(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ") // strip punctuation / symbols → space
    .replace(/\s+/g, " ")          // collapse runs of whitespace
    .trim();
}
