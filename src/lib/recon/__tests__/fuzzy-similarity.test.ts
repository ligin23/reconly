import { describe, it, expect } from "vitest";
import { normalize } from "../normalize";
import {
  stripNoiseTokens,
  fuzzyDescriptionSimilarity,
  descriptionSimilarity,
} from "../similarity";
import {
  computeFuzzyConfidence,
  FUZZY_DESC_FLOOR,
  NEAR_DESC_THRESHOLD,
  DATE_WINDOW,
} from "../engine";

/** Shorthand: normalize both sides, then fuzzy-score. */
function fuzzy(a: string, b: string): number {
  return fuzzyDescriptionSimilarity(normalize(a), normalize(b));
}

// ======================================================================
// 1. Noise-token stripping
// ======================================================================

describe("stripNoiseTokens", () => {
  it("strips a leading payment-rail prefix", () => {
    expect(stripNoiseTokens(normalize("SQ *BLUE BOTTLE COFFEE"))).toBe(
      "BLUE BOTTLE COFFEE"
    );
  });

  it("strips store numbers and the STORE filler word", () => {
    expect(stripNoiseTokens(normalize("STARBUCKS STORE 04412"))).toBe(
      "STARBUCKS"
    );
  });

  it("strips trailing reference codes and country suffixes", () => {
    expect(stripNoiseTokens(normalize("WHOLEFDS MKT US*7X1"))).toBe(
      "WHOLEFDS MKT"
    );
  });

  it("strips a trailing state code but not a state code mid-name", () => {
    expect(stripNoiseTokens(normalize("HMSTD CAFE OAKLAND CA"))).toBe(
      "HMSTD CAFE OAKLAND"
    );
    // "CA" at the front is not a location suffix
    expect(stripNoiseTokens(normalize("CA WATER SERVICE"))).toBe(
      "CA WATER SERVICE"
    );
  });

  it("does not strip rail words appearing mid-description", () => {
    // "POS" leads → stripped; "SYSTEMS" survives; vendor named after a rail
    // word mid-string is untouched
    expect(stripNoiseTokens(normalize("ACME POS SYSTEMS"))).toBe(
      "ACME POS SYSTEMS"
    );
  });

  it("returns empty string when the description is pure noise", () => {
    expect(stripNoiseTokens(normalize("POS DEBIT 04412"))).toBe("");
  });

  it("never strips the only remaining token as a location suffix", () => {
    // A vendor literally named "CA" should not vanish
    expect(stripNoiseTokens(normalize("CA"))).toBe("CA");
  });
});

// ======================================================================
// 2. Fuzzy similarity scoring
// ======================================================================

describe("fuzzyDescriptionSimilarity", () => {
  it("'SQ *BLUE BOTTLE COFFEE' vs 'Blue Bottle Coffee' scores high", () => {
    expect(fuzzy("SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee")).toBe(1);
  });

  it("'STARBUCKS STORE 04412' vs 'Starbucks' scores high", () => {
    expect(fuzzy("STARBUCKS STORE 04412", "Starbucks")).toBe(1);
  });

  it("'PAYPAL *JOHNSPLUMBING' vs \"John's Plumbing\" clears the floor", () => {
    // Token overlap is zero (one fused word vs two), so the trigram
    // component must carry it across the floor
    const score = fuzzy("PAYPAL *JOHNSPLUMBING", "John's Plumbing");
    expect(score).toBeGreaterThanOrEqual(FUZZY_DESC_FLOOR);
  });

  it("two unrelated same-amount vendors score below the floor", () => {
    expect(fuzzy("CEDAR BANK FEE", "HARBORLINE CONSULTING")).toBeLessThan(
      FUZZY_DESC_FLOOR
    );
    expect(fuzzy("TST* PIZZERIA OTTO 0042", "Lakeside Hardware")).toBeLessThan(
      FUZZY_DESC_FLOOR
    );
  });

  it("hard abbreviations stay below the floor (conservative bias)", () => {
    // "WMT" vs "Walmart" — accepted false-negative per design
    expect(fuzzy("WMT US*2K4LP9", "Walmart")).toBeLessThan(FUZZY_DESC_FLOOR);
  });

  it("pure-noise descriptions score 0, never 1", () => {
    // Both sides strip to nothing → fall back to un-stripped strings,
    // which differ; two literally-empty descriptions carry no evidence
    expect(fuzzy("POS DEBIT 04412", "ACH 99812")).toBeLessThan(
      FUZZY_DESC_FLOOR
    );
    expect(fuzzyDescriptionSimilarity("", "")).toBe(0);
  });

  it("is deterministic — repeated calls return the identical score", () => {
    const pairs: Array<[string, string]> = [
      ["SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee"],
      ["STARBUCKS STORE 04412", "Starbucks"],
      ["CEDAR BANK FEE", "HARBORLINE CONSULTING"],
      ["WHOLEFDS MKT US*7X1", "Whole Foods Market"],
    ];
    for (const [a, b] of pairs) {
      const first = fuzzy(a, b);
      for (let i = 0; i < 5; i++) {
        expect(fuzzy(a, b)).toBe(first);
      }
    }
  });

  it("is symmetric", () => {
    const ab = fuzzy("WHOLEFDS MKT US*7X1", "Whole Foods Market");
    const ba = fuzzy("Whole Foods Market", "WHOLEFDS MKT US*7X1");
    expect(ab).toBe(ba);
  });

  it("rescues a noise-heavy pair the near tier misses", () => {
    // The reason this tier exists: raw similarity below the near threshold
    // (noise dilutes both token and trigram Jaccard), cleaned similarity
    // above the fuzzy floor
    const a = normalize(
      "POS DEBIT 9921 STARBUCKS RESERVE 04412 SEATTLE WA REF 2200391"
    );
    const b = normalize("Starbucks coffee");
    expect(descriptionSimilarity(a, b)).toBeLessThan(NEAR_DESC_THRESHOLD);
    expect(fuzzyDescriptionSimilarity(a, b)).toBeGreaterThanOrEqual(
      FUZZY_DESC_FLOOR
    );
  });
});

// ======================================================================
// 3. Fuzzy confidence mapping
// ======================================================================

describe("computeFuzzyConfidence", () => {
  it("stays strictly inside the 50–69 band", () => {
    for (let dateDiff = 0; dateDiff <= DATE_WINDOW; dateDiff++) {
      for (let sim = 0; sim <= 1.0001; sim += 0.05) {
        const c = computeFuzzyConfidence(dateDiff, sim);
        expect(c).toBeGreaterThanOrEqual(50);
        expect(c).toBeLessThanOrEqual(69);
      }
    }
  });

  it("peaks at 69 for a perfect description on the same day", () => {
    expect(computeFuzzyConfidence(0, 1)).toBe(69);
  });

  it("bottoms at 50 for a floor-level description at the window edge", () => {
    expect(computeFuzzyConfidence(DATE_WINDOW, FUZZY_DESC_FLOOR)).toBe(50);
  });

  it("rewards closer dates and stronger descriptions monotonically", () => {
    expect(computeFuzzyConfidence(0, 0.8)).toBeGreaterThan(
      computeFuzzyConfidence(3, 0.8)
    );
    expect(computeFuzzyConfidence(2, 0.9)).toBeGreaterThan(
      computeFuzzyConfidence(2, 0.4)
    );
  });

  it("is deterministic", () => {
    const first = computeFuzzyConfidence(3, 0.62);
    for (let i = 0; i < 5; i++) {
      expect(computeFuzzyConfidence(3, 0.62)).toBe(first);
    }
  });
});
