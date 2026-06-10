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

// ============================================================
// Fuzzy-tier scoring — strips bank-statement noise before comparing.
// Layered on top of normalize() output; never replaces it.
// Still deterministic: no AI, no RNG.
// ============================================================

/**
 * Payment-rail / card-processor prefixes that carry no vendor information.
 * Stripped only from the FRONT of a description (where rails print them),
 * so a vendor legitimately named e.g. "POS Systems Co" mid-string survives.
 * Editable: extend this list when expert feedback names a new rail.
 */
export const RAIL_PREFIX_TOKENS = new Set([
  "SQ",        // Square
  "TST",       // Toast
  "SP",        // Square (subscriptions)
  "PY",        // Square (payroll)
  "PAYPAL",
  "PP",
  "ACH",
  "POS",
  "DEBIT",
  "CHECKCARD",
  "CHKCARD",
]);

/**
 * Generic bank-statement filler words that appear anywhere in a description
 * and never identify the vendor. Editable, same as RAIL_PREFIX_TOKENS.
 */
export const NOISE_WORDS = new Set(["STORE", "REF", "PMT", "XFER"]);

/**
 * Location suffixes banks append after the vendor name: the 50 US state
 * codes plus DC and "US" itself. Stripped only from the END of a description.
 */
export const LOCATION_SUFFIX_TOKENS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "US",
]);

/** True for tokens that contain a digit: store numbers ("04412", "#4412"
 *  after normalize) and reference codes ("7X1", "2K4LP9"). */
function isDigitBearing(token: string): boolean {
  return /[0-9]/.test(token);
}

/**
 * Strip bank-noise tokens from an already-normalized description:
 *   1. leading payment-rail prefixes ("SQ BLUE BOTTLE" → "BLUE BOTTLE")
 *   2. digit-bearing tokens anywhere (store numbers, reference codes)
 *   3. generic filler words anywhere ("STORE", "REF", …)
 *   4. trailing location codes ("WHOLEFDS MKT US" → "WHOLEFDS MKT")
 * Returns "" when the description was nothing but noise — callers must
 * fall back to the un-stripped string rather than compare empties.
 */
export function stripNoiseTokens(norm: string): string {
  let parts = norm.split(" ").filter(Boolean);

  while (parts.length > 0 && RAIL_PREFIX_TOKENS.has(parts[0])) {
    parts = parts.slice(1);
  }

  parts = parts.filter((t) => !isDigitBearing(t) && !NOISE_WORDS.has(t));

  while (
    parts.length > 1 &&
    LOCATION_SUFFIX_TOKENS.has(parts[parts.length - 1])
  ) {
    parts = parts.slice(0, -1);
  }

  return parts.join(" ");
}

/**
 * Overlap coefficient: |A ∩ B| / min(|A|, |B|).
 * Unlike Jaccard, the longer side's extra elements don't dilute the score —
 * it asks "is the smaller set contained in the larger one?", which is the
 * right question when one description is terse ("Starbucks") and the other
 * is a noisy bank string or a verbose ledger memo.
 */
function overlapCoefficient<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x));
  return intersection.length / Math.min(a.size, b.size);
}

/**
 * Fuzzy-tier similarity between two already-normalized descriptions.
 * Strips noise tokens from each side first (falling back to the un-stripped
 * string when stripping leaves nothing), then blends word-level and
 * character-level evidence:
 *
 *   0.6 × tokenJaccard + 0.4 × trigramContainment
 *
 * Token side is strict Jaccard (per-word agreement); character side is the
 * overlap coefficient on trigrams, which handles fused words
 * ("JOHNSPLUMBING" / "JOHNS PLUMBING") and terse-vs-verbose pairs that
 * union-based measures punish. A weighted blend — not max() like
 * descriptionSimilarity — keeps the tier conservative: character containment
 * alone caps the score at 0.4, so a coincidental substring can't carry a
 * match by itself. Returns a value in [0, 1]. Deterministic.
 */
export function fuzzyDescriptionSimilarity(
  normA: string,
  normB: string
): number {
  const cleanA = stripNoiseTokens(normA) || normA;
  const cleanB = stripNoiseTokens(normB) || normB;
  if (cleanA === "" || cleanB === "") return 0; // blank descriptions carry no evidence
  const tokenScore = jaccard(tokens(cleanA), tokens(cleanB));
  const trigramScore = overlapCoefficient(trigrams(cleanA), trigrams(cleanB));
  return 0.6 * tokenScore + 0.4 * trigramScore;
}
