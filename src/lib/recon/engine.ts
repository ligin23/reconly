// ============================================================
// Reconly reconciliation engine
// Pure TypeScript. No React. No framework. No AI. No randomness.
// Independently unit-testable.
// ============================================================

import { normalize } from "./normalize";
import {
  descriptionSimilarity,
  fuzzyDescriptionSimilarity,
} from "./similarity";
import type {
  Txn,
  Match,
  MatchType,
  ReconResult,
  BalanceProof,
  ReasonDetail,
  AnyCompositeMatch,
  CompositeMatch,
  AmbiguousCompositeMatch,
} from "./types";

// ---- Constants -------------------------------------------------------

/** Maximum date gap (inclusive) for a near match, in days. */
export const DATE_WINDOW = 5;

// ---- Description-similarity thresholds (the two tuning dials) --------
//
// Both dials gate what the engine will SUGGEST — neither ever overrides the
// amount gate. Tier order as the user sees it: exact (100) > near (70–99) >
// fuzzy (50–69). "Too loose / too strict" feedback is fixed by turning the
// matching dial below, not by editing logic.

/**
 * NEAR dial — minimum descriptionSimilarity (0–1, raw normalized strings)
 * for a near match. Below this the engine won't propose a near pairing even
 * when amount and date line up (except the tight ≤1-day window, see reconcile).
 */
export const NEAR_DESC_THRESHOLD = 0.15;

/**
 * FUZZY dial — minimum fuzzyDescriptionSimilarity (0–1, noise-stripped
 * strings) for a fuzzy suggestion. Pairs scoring below this floor stay in
 * the missing buckets: missing a real match is cheap (user can pair it
 * manually), asserting a wrong one is expensive. Raise to tighten, lower to
 * loosen. Note the two dials read different scales — fuzzy scores are
 * computed on noise-stripped text with a conservative blend, so this floor
 * is intentionally higher than NEAR_DESC_THRESHOLD.
 */
export const FUZZY_DESC_FLOOR = 0.3;

// ---- Composite matching constants ------------------------------------

/**
 * Maximum date gap between a composite component and its target transaction.
 * Wider than DATE_WINDOW because batched deposits can cover a week+ of invoices.
 */
export const COMPOSITE_DATE_WINDOW = 14;

/** Minimum number of items in a composite group (groups of 1 are one-to-one matches). */
export const COMPOSITE_MIN_GROUP = 2;

/** Maximum number of items in a composite group. Bounds the subset-sum search. */
export const COMPOSITE_MAX_GROUP = 4;

/** Fixed confidence for composite suggestions (exact sum, but which items are uncertain). */
const COMPOSITE_CONFIDENCE = 85;

/**
 * Maximum candidate pool per composite target. The subset-sum search
 * enumerates C(n,2)+C(n,3)+C(n,4) combinations; without a cap, a busy
 * window (200 candidates ≈ 65M combinations) freezes the browser. When the
 * pool exceeds the cap, the candidates closest by date are kept —
 * deterministic, and the most likely true components anyway.
 */
export const COMPOSITE_MAX_CANDIDATES = 20;

// ---- Internal helpers ------------------------------------------------

function dateDiffDays(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / msPerDay
  );
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return (
    "$" +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Confidence score for a near match.
 * Formula: 70 + round(dateScore × 15 + descScore × 14), clamped [70, 99].
 *   dateScore = (DATE_WINDOW − dateDiff) / DATE_WINDOW  →  0–1
 *   descScore = similarity result                        →  0–1
 * Maximum possible: 70 + 15 + 14 = 99 ✓
 * Exact matches always return 100 (separate code path).
 */
function computeNearConfidence(dateDiff: number, descSim: number): number {
  const dateScore = (DATE_WINDOW - dateDiff) / DATE_WINDOW;
  const raw = 70 + Math.round(dateScore * 15 + descSim * 14);
  return Math.max(70, Math.min(99, raw));
}

/**
 * Confidence score for a fuzzy match — the band strictly below near.
 * Formula: 50 + round(descFactor × 12 + dateScore × 7), clamped [50, 69].
 *   descFactor = (fuzzySim − FUZZY_DESC_FLOOR) / (1 − FUZZY_DESC_FLOOR) → 0–1
 *                (how far above the floor the description evidence sits)
 *   dateScore  = (DATE_WINDOW − dateDiff) / DATE_WINDOW                 → 0–1
 * Maximum possible: 50 + 12 + 7 = 69 — never touches the near band ✓
 * Exported for unit tests; reconcile() is the only production caller.
 */
export function computeFuzzyConfidence(
  dateDiff: number,
  fuzzySim: number
): number {
  const descFactor = Math.max(
    0,
    (Math.min(fuzzySim, 1) - FUZZY_DESC_FLOOR) / (1 - FUZZY_DESC_FLOOR)
  );
  const dateScore = (DATE_WINDOW - dateDiff) / DATE_WINDOW;
  const raw = 50 + Math.round(descFactor * 12 + dateScore * 7);
  return Math.max(50, Math.min(69, raw));
}

/**
 * Build the reasons array from which checks fired.
 * These strings are the source of truth for the "Why?" panel in the UI.
 * They are not free text — each originates from a specific boolean check.
 */
function buildReasons(
  matchType: MatchType,
  dateDiff: number,
  descSim: number,
  amount: number
): string[] {
  const reasons: string[] = [];

  // --- Amount check (always present) ---
  reasons.push(`Amounts match exactly (${formatCents(amount)})`);

  if (matchType === "exact") {
    reasons.push("Same date");
    reasons.push("Descriptions match");
    return reasons;
  }

  // --- Date check ---
  if (dateDiff === 0) {
    reasons.push("Same day");
  } else {
    reasons.push(
      `Dates differ by ${dateDiff} day${dateDiff === 1 ? "" : "s"}`
    );
  }

  // --- Description check ---
  if (matchType === "fuzzy") {
    // Fuzzy scores are computed on noise-stripped text — say so plainly
    if (descSim >= 0.7) {
      reasons.push("Names match well once store and bank codes are removed");
    } else {
      reasons.push(
        "Descriptions are somewhat similar after removing store and bank codes"
      );
    }
  } else if (descSim >= 0.5) {
    reasons.push("Names look like the same company");
  } else if (descSim >= 0.25) {
    reasons.push("Names look similar");
  } else {
    reasons.push("Wording is quite different");
  }

  return reasons;
}

// ---- Composite matching helpers --------------------------------------

/** True when `amount` has the same sign as `reference` (both + or both −). */
function hasSameSignAs(amount: number, reference: number): boolean {
  if (reference > 0) return amount > 0;
  if (reference < 0) return amount < 0;
  return true; // reference is 0 — treat as compatible
}

/**
 * Generate all combinations of exactly `size` items from `items`.
 * Order is determined by the order of `items` — sort before calling for stability.
 */
function getCombinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [
    ...getCombinations(rest, size - 1).map((c) => [first, ...c]),
    ...getCombinations(rest, size),
  ];
}

function buildCompositeReasons(targetTxn: Txn, components: Txn[]): string[] {
  const n = components.length;
  const total = formatCents(Math.abs(targetTxn.amount));
  const direction = targetTxn.amount >= 0 ? "deposit" : "payment";
  const reasons: string[] = [
    `These ${n} items add up to ${total}, matching this ${direction}`,
    "Sum is exact to the cent",
  ];
  const dates = components.map((t) => t.date).sort();
  const spanDays = dateDiffDays(dates[0], dates[dates.length - 1]);
  if (spanDays === 0) {
    reasons.push("All components are on the same day");
  } else {
    reasons.push(`Components span ${spanDays} day${spanDays === 1 ? "" : "s"}`);
  }
  return reasons;
}

function buildAmbiguousCompositeReasons(
  targetTxn: Txn,
  comboCount: number
): string[] {
  const total = formatCents(Math.abs(targetTxn.amount));
  return [
    `${comboCount} different combinations of items add up to ${total}`,
    "Please choose which items make up this transaction",
  ];
}

// ---- Public API -------------------------------------------------------

/**
 * Convert a flat reasons string[] into {ok, text}[] for the review UI.
 *
 * Rules: a reason is "ok" (green check) when it describes something that
 * supports the match; "not ok" (yellow minus) when it highlights a difference.
 * This is the seam that Phase 3 uses to wire engine output to the existing UI.
 */
export function enrichReasons(reasons: string[]): ReasonDetail[] {
  const negativePatterns = [
    /^dates differ/i,
    /^wording is quite different/i,
    /^descriptions are somewhat similar/i, // fuzzy: cautionary, not confirming
    /^names don.t/i,
    /^amount is off/i,
    /^hard to tell/i,
    /^might be/i,
    /^logged twice/i,
    /^\d+ different combinations/i, // ambiguous composite: multiple candidates
    /^please choose/i,              // ambiguous composite: action required
  ];
  return reasons.map((text) => ({
    ok: !negativePatterns.some((re) => re.test(text)),
    text,
  }));
}

/**
 * Find composite matches: groups of COMPOSITE_MIN_GROUP–COMPOSITE_MAX_GROUP
 * transactions from `manySideTxns` that sum exactly to individual transactions
 * in `oneSideTxns`.
 *
 * Role-parameterized: the function knows nothing about bank vs ledger.
 * Current wiring (Phase 2): oneSideTxns = unmatched bank, manySideTxns = unmatched ledger.
 * Reverse direction (future seam): swap the arguments.
 *
 * Classification:
 *   Exactly one valid combination  → CompositeMatch  (ambiguous: false, status: "suggested")
 *   More than one valid combination → AmbiguousCompositeMatch (ambiguous: true, status: "suggested")
 *   No valid combination            → nothing returned for that target
 *
 * Deduplication: if two one-side txns compete for the same many-side IDs, the
 * earlier one (by date, then id) wins and the later one is dropped entirely.
 * This preserves the nothing-double-counted invariant.
 *
 * Determinism: input arrays are copied and sorted before processing; combination
 * order and output order are fully determined by (date, id) sort keys.
 */
export function findCompositeMatches(
  oneSideTxns: Txn[],
  manySideTxns: Txn[]
): AnyCompositeMatch[] {
  // Sort many-side deterministically so getCombinations output is stable
  const sortedMany = [...manySideTxns].sort((a, b) =>
    a.date !== b.date ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id)
  );

  type RawResult = {
    oneTxnId: string;
    oneDate: string;
    validCombos: string[][];
  };

  // Phase A: find all valid combinations for each one-side transaction
  const raw: RawResult[] = [];

  for (const one of oneSideTxns) {
    // Constraints: same sign + within date window
    let candidates = sortedMany.filter(
      (m) =>
        hasSameSignAs(m.amount, one.amount) &&
        dateDiffDays(m.date, one.date) <= COMPOSITE_DATE_WINDOW
    );

    // Bound the subset-sum search (see COMPOSITE_MAX_CANDIDATES). Keep the
    // date-closest candidates, then restore (date, id) order for stable
    // combination enumeration.
    if (candidates.length > COMPOSITE_MAX_CANDIDATES) {
      candidates = [...candidates]
        .sort((a, b) => {
          const da = dateDiffDays(a.date, one.date);
          const db = dateDiffDays(b.date, one.date);
          if (da !== db) return da - db;
          return a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.id.localeCompare(b.id);
        })
        .slice(0, COMPOSITE_MAX_CANDIDATES)
        .sort((a, b) =>
          a.date !== b.date
            ? a.date.localeCompare(b.date)
            : a.id.localeCompare(b.id)
        );
    }

    const validCombos: string[][] = [];

    for (let size = COMPOSITE_MIN_GROUP; size <= COMPOSITE_MAX_GROUP; size++) {
      for (const combo of getCombinations(candidates, size)) {
        const comboSum = combo.reduce((s, t) => s + t.amount, 0);
        if (comboSum === one.amount) {
          validCombos.push(combo.map((t) => t.id));
        }
      }
    }

    if (validCombos.length > 0) {
      raw.push({ oneTxnId: one.id, oneDate: one.date, validCombos });
    }
  }

  // Sort raw results deterministically so deduplication is stable (earlier txn wins)
  raw.sort((a, b) =>
    a.oneDate !== b.oneDate
      ? a.oneDate.localeCompare(b.oneDate)
      : a.oneTxnId.localeCompare(b.oneTxnId)
  );

  // Phase B: greedy deduplication — claim all IDs needed by a composite before
  // evaluating the next one. Any composite that needs an already-claimed ID is dropped.
  const consumed = new Set<string>();
  const results: AnyCompositeMatch[] = [];

  for (const r of raw) {
    // All IDs that would be "locked up" by this composite (union across all combos)
    const allIdsNeeded = [...new Set(r.validCombos.flat())].sort();

    if (allIdsNeeded.some((id) => consumed.has(id))) continue;

    allIdsNeeded.forEach((id) => consumed.add(id));

    const one = oneSideTxns.find((t) => t.id === r.oneTxnId)!;
    const compositeId = `composite:${r.oneTxnId}`;

    if (r.validCombos.length === 1) {
      const ledgerTxnIds = r.validCombos[0];
      const components = ledgerTxnIds
        .map((id) => manySideTxns.find((t) => t.id === id)!)
        .filter(Boolean);
      results.push({
        id: compositeId,
        bankTxnId: r.oneTxnId,
        ledgerTxnIds,
        type: "composite",
        confidence: COMPOSITE_CONFIDENCE,
        status: "suggested",
        reasons: buildCompositeReasons(one, components),
        ambiguous: false,
        allCombinations: null,
      } satisfies CompositeMatch);
    } else {
      // Normalise each combo (sorted IDs) then sort the combos array for determinism
      const sortedCombos = r.validCombos
        .map((c) => [...c].sort())
        .sort((a, b) => a.join(",").localeCompare(b.join(",")));
      results.push({
        id: compositeId,
        bankTxnId: r.oneTxnId,
        ledgerTxnIds: allIdsNeeded,
        type: "composite",
        confidence: COMPOSITE_CONFIDENCE,
        status: "suggested",
        reasons: buildAmbiguousCompositeReasons(one, r.validCombos.length),
        ambiguous: true,
        allCombinations: sortedCombos,
      } satisfies AmbiguousCompositeMatch);
    }
  }

  return results;
}

/**
 * Run the reconciliation engine.
 *
 * Matching rules:
 *   Exact  — same amount AND same date AND normalized descriptions equal
 *            → confidence 100, status "accepted"
 *   Near   — same amount AND date within ±DATE_WINDOW days AND description
 *            similarity ≥ NEAR_DESC_THRESHOLD
 *            → confidence deterministic [70–99], status "suggested"
 *   Fuzzy  — runs LAST, only on leftovers after exact, near, and composite.
 *            Same amount AND date within ±DATE_WINDOW days AND noise-stripped
 *            description similarity ≥ FUZZY_DESC_FLOOR
 *            → confidence deterministic [50–69], ALWAYS status "suggested"
 *
 * Assignment is one-to-one, resolved greedily highest-confidence-first.
 * Balance proof: unexplainedDifference = bankNetChange − ledgerNetChange.
 *   A high match % with a nonzero unexplainedDifference is NOT reconciled —
 *   and a zero net alone isn't either: reconciled additionally requires both
 *   missing buckets to be empty (offsetting errors must not read as clean).
 */
export function reconcile(
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): ReconResult {
  // ---- 1. Generate candidate pairs ---------------------------------
  type Candidate = {
    bankId: string;
    ledgerId: string;
    matchType: MatchType;
    confidence: number;
    reasons: string[];
  };

  const candidates: Candidate[] = [];

  for (const bank of bankTxns) {
    for (const ledger of ledgerTxns) {
      // Amounts must match to the cent (signed)
      if (bank.amount !== ledger.amount) continue;

      const dateDiff = dateDiffDays(bank.date, ledger.date);
      const normBank = normalize(bank.description);
      const normLedger = normalize(ledger.description);

      // A description that normalizes to "" carries zero evidence — it must
      // never auto-accept as exact ("" === "" is not a match, it's two
      // unknowns). Such pairs can still surface via the tight ≤1-day near
      // window below, but only as a reviewable suggestion.
      if (dateDiff === 0 && normBank === normLedger && normBank !== "") {
        // Exact match
        candidates.push({
          bankId: bank.id,
          ledgerId: ledger.id,
          matchType: "exact",
          confidence: 100,
          reasons: buildReasons("exact", 0, 1, bank.amount),
        });
      } else if (dateDiff <= DATE_WINDOW) {
        const descSim = descriptionSimilarity(normBank, normLedger);
        // When amount matches to the cent AND dates are within 1 day, the
        // amount+date signal is strong enough to propose a near match even
        // when wording diverges (e.g. "AMZN MKTP US*…" vs "Amazon - …").
        // Outside that tight window, require description similarity.
        const tightAmountAndDate = dateDiff <= 1;
        if (descSim >= NEAR_DESC_THRESHOLD || tightAmountAndDate) {
          const confidence = computeNearConfidence(dateDiff, descSim);
          candidates.push({
            bankId: bank.id,
            ledgerId: ledger.id,
            matchType: "near",
            confidence,
            reasons: buildReasons("near", dateDiff, descSim, bank.amount),
          });
        }
      }
    }
  }

  // ---- 2. Greedy one-to-one assignment (highest confidence first) --
  candidates.sort((a, b) => b.confidence - a.confidence);

  const usedBankIds = new Set<string>();
  const usedLedgerIds = new Set<string>();
  const matches: Match[] = [];

  for (const c of candidates) {
    if (usedBankIds.has(c.bankId) || usedLedgerIds.has(c.ledgerId)) continue;
    usedBankIds.add(c.bankId);
    usedLedgerIds.add(c.ledgerId);
    matches.push({
      id: `${c.bankId}:${c.ledgerId}`,
      bankTxnId: c.bankId,
      ledgerTxnId: c.ledgerId,
      type: c.matchType,
      confidence: c.confidence,
      status: c.matchType === "exact" ? "accepted" : "suggested",
      reasons: c.reasons,
    });
  }

  // ---- 3. Categorize unmatched txns --------------------------------
  const unmatchedBank = bankTxns.filter((t) => !usedBankIds.has(t.id));
  const unmatchedLedger = ledgerTxns.filter((t) => !usedLedgerIds.has(t.id));

  // ---- 3b. Composite matching on one-to-one leftovers --------------
  // Many-ledger → one-bank direction. Items claimed by any composite are
  // removed from the base missing lists; the adapter re-adds them if the
  // composite is later rejected by the user.
  const compositeMatches = findCompositeMatches(unmatchedBank, unmatchedLedger);

  const compositeBankIds = new Set(compositeMatches.map((c) => c.bankTxnId));
  const compositeLedgerIds = new Set(
    compositeMatches.flatMap((c) => c.ledgerTxnIds)
  );

  const leftoverBank = unmatchedBank.filter(
    (t) => !compositeBankIds.has(t.id)
  );
  const leftoverLedger = unmatchedLedger.filter(
    (t) => !compositeLedgerIds.has(t.id)
  );

  // ---- 3c. Fuzzy tier on the remaining leftovers --------------------
  // Lowest-confidence band (50–69), suggestion-only, one-to-one. Same hard
  // gates as exact/near: amount equal to the signed cent FIRST, then date
  // within DATE_WINDOW — description similarity never overrides either.
  // Confidences here are all below near's band, so greedy-within-tier is
  // equivalent to global highest-confidence-first across tiers.
  type FuzzyCandidate = {
    bankId: string;
    ledgerId: string;
    confidence: number;
    dateDiff: number;
    fuzzySim: number;
    amount: number;
  };

  const fuzzyCandidates: FuzzyCandidate[] = [];

  for (const bank of leftoverBank) {
    for (const ledger of leftoverLedger) {
      if (bank.amount !== ledger.amount) continue; // amount gates first, always

      const dateDiff = dateDiffDays(bank.date, ledger.date);
      if (dateDiff > DATE_WINDOW) continue;

      const fuzzySim = fuzzyDescriptionSimilarity(
        normalize(bank.description),
        normalize(ledger.description)
      );
      if (fuzzySim < FUZZY_DESC_FLOOR) continue; // conservative: near the floor, don't suggest

      fuzzyCandidates.push({
        bankId: bank.id,
        ledgerId: ledger.id,
        confidence: computeFuzzyConfidence(dateDiff, fuzzySim),
        dateDiff,
        fuzzySim,
        amount: bank.amount,
      });
    }
  }

  fuzzyCandidates.sort((a, b) => b.confidence - a.confidence);

  const fuzzyBankIds = new Set<string>();
  const fuzzyLedgerIds = new Set<string>();

  for (const c of fuzzyCandidates) {
    if (fuzzyBankIds.has(c.bankId) || fuzzyLedgerIds.has(c.ledgerId)) continue;
    fuzzyBankIds.add(c.bankId);
    fuzzyLedgerIds.add(c.ledgerId);
    matches.push({
      id: `${c.bankId}:${c.ledgerId}`,
      bankTxnId: c.bankId,
      ledgerTxnId: c.ledgerId,
      type: "fuzzy",
      confidence: c.confidence,
      status: "suggested", // NEVER auto-accepted — by definition too uncertain
      reasons: buildReasons("fuzzy", c.dateDiff, c.fuzzySim, c.amount),
    });
  }

  const missingFromBooks = leftoverBank.filter((t) => !fuzzyBankIds.has(t.id));
  const missingFromBank = leftoverLedger.filter(
    (t) => !fuzzyLedgerIds.has(t.id)
  );

  // ---- 4. Balance proof -------------------------------------------
  // unexplainedDifference = bankNetChange − ledgerNetChange.
  // A high match % alone does NOT make this zero.
  // clearedSum includes accepted composites; composites start as "suggested"
  // so the composite term is 0 here — app-shell recalculates live as the user
  // makes decisions.
  const bankNetChange = bankTxns.reduce((s, t) => s + t.amount, 0);
  const ledgerNetChange = ledgerTxns.reduce((s, t) => s + t.amount, 0);
  const clearedSum =
    matches
      .filter((m) => m.status === "accepted")
      .reduce((s, m) => {
        const t = bankTxns.find((b) => b.id === m.bankTxnId);
        return s + (t?.amount ?? 0);
      }, 0) +
    compositeMatches
      .filter((c) => c.status === "accepted")
      .reduce((s, c) => {
        const t = bankTxns.find((b) => b.id === c.bankTxnId);
        return s + (t?.amount ?? 0);
      }, 0);
  const unexplainedDifference = bankNetChange - ledgerNetChange;

  const balanceProof: BalanceProof = {
    bankNetChange,
    ledgerNetChange,
    clearedSum,
    unexplainedDifference,
  };

  // "Reconciled" means every item is explained, not merely that the nets
  // agree: equal-and-opposite unmatched items (a missing $50 fee plus a
  // missing $50 deposit) cancel in the net but are NOT reconciled. This is
  // the first-pass engine verdict; pending-suggestion awareness lives in
  // deriveStatus and the live UI status, which track user decisions.
  const reconciled =
    unexplainedDifference === 0 &&
    missingFromBooks.length === 0 &&
    missingFromBank.length === 0;

  return {
    matches,
    compositeMatches,
    missingFromBooks,
    missingFromBank,
    balanceProof,
    reconciled,
  };
}
