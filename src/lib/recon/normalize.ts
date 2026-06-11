// ============================================================
// Text normalization — single swappable function.
// Uppercase, strip punctuation, collapse whitespace.
// ============================================================

/**
 * Normalizes a transaction description for comparison.
 * Swapping this function changes matching behavior globally.
 *
 * Unicode-aware: letters in any script (CJK, Cyrillic, Arabic, …) are kept,
 * not stripped — deleting them collapsed all non-Latin descriptions to ""
 * and made unrelated transactions compare as identical. Diacritics are
 * folded ("CAFÉ" → "CAFE") so accented spellings of the same vendor match.
 */
export function normalize(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")          // fold diacritics (É → E)
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // strip punctuation / symbols → space
    .replace(/\s+/g, " ")            // collapse runs of whitespace
    .trim();
}
