// ============================================================
// Reconly — user review decisions over engine output
// Pure TypeScript. No React. Does NOT touch the matching engine: these
// functions only record what the user decided about matches the engine
// already proposed, and restore those decisions when a saved
// reconciliation is reopened.
// ============================================================

import type { Match, AnyCompositeMatch } from "./types";

/** The only decisions a user can make on a suggested pairing. */
export type UserDecision = "accept" | "reject";

/**
 * Record a yes/no on a one-to-one suggestion.
 *
 * There is deliberately no third "manual" outcome (B10): the old "Match
 * manually" button stored status "manual", which every total counted as a
 * confirmed match — so a user saying "this pairing is wrong, I'll sort it
 * out myself" was silently confirming it.
 */
export function applyMatchDecision(
  matches: Match[],
  matchId: string,
  decision: UserDecision
): Match[] {
  const status = decision === "accept" ? "accepted" : "rejected";
  return matches.map((m) => (m.id === matchId ? { ...m, status } : m));
}

/**
 * Record a yes/no on a composite suggestion. Accepting an ambiguous
 * composite requires the combination the user picked; without one the
 * composite is left untouched (never auto-selected).
 */
export function applyCompositeDecision(
  composites: AnyCompositeMatch[],
  compositeId: string,
  decision: UserDecision,
  pickedCombination?: string[]
): AnyCompositeMatch[] {
  return composites.map((c): AnyCompositeMatch => {
    if (c.id !== compositeId) return c;
    if (decision === "reject") return { ...c, status: "rejected" } as AnyCompositeMatch;
    if (c.ambiguous) {
      if (!pickedCombination || !isOfferedCombination(c.allCombinations, pickedCombination)) {
        return c;
      }
      return {
        ...c,
        status: "accepted",
        ledgerTxnIds: pickedCombination,
        ambiguous: false,
        allCombinations: null,
      };
    }
    return { ...c, status: "accepted" };
  });
}

function isOfferedCombination(offered: string[][], picked: string[]): boolean {
  const key = (ids: string[]) => [...ids].sort().join("\u0000");
  const want = key(picked);
  return offered.some((combo) => key(combo) === want);
}

/**
 * Overlay saved one-to-one decisions onto a fresh engine run.
 *
 * A saved status of "manual" (written by the old "Match manually" button,
 * B10) is NOT restored: it was recorded as a confirmed match although the
 * user never confirmed one. The pairing goes back to "suggested" so the
 * user gives it an explicit yes or no.
 */
export function restoreMatches(fresh: Match[], saved: Match[]): Match[] {
  const savedById = new Map(saved.map((s) => [s.id, s]));
  return fresh.map((m) => {
    const s = savedById.get(m.id);
    if (!s || s.status === "manual") return m;
    return { ...m, status: s.status };
  });
}

/**
 * Overlay saved composite decisions onto a fresh engine run.
 *
 * B13: for an ambiguous composite the user's decision is not just a status
 * — it is WHICH combination they picked. Restoring only the status put the
 * union of every candidate back as "matched", so exports and totals listed
 * ledger items the user never chose. The picked combination is restored
 * only when it is still one the engine offers; otherwise the composite
 * returns to review rather than guessing.
 */
export function restoreComposites(
  fresh: AnyCompositeMatch[],
  saved: AnyCompositeMatch[]
): AnyCompositeMatch[] {
  const savedById = new Map(saved.map((s) => [s.id, s]));
  return fresh.map((c): AnyCompositeMatch => {
    const s = savedById.get(c.id);
    if (!s) return c;
    if (s.status === "accepted" && c.ambiguous) {
      if (!s.ambiguous && isOfferedCombination(c.allCombinations, s.ledgerTxnIds)) {
        return {
          ...c,
          status: "accepted",
          ledgerTxnIds: s.ledgerTxnIds,
          ambiguous: false,
          allCombinations: null,
        };
      }
      return c; // pick unknown or no longer offered → ask again
    }
    return { ...c, status: s.status } as AnyCompositeMatch;
  });
}

/**
 * Review progress (B12). The denominator is every item that ever needed a
 * decision — it must not shrink as items are decided — and the numerator is
 * how many of those now have one.
 */
export function reviewProgress(
  matches: Pick<Match, "type" | "status">[],
  composites: Pick<AnyCompositeMatch, "status">[]
): { total: number; decided: number; pending: number } {
  const reviewable = matches.filter((m) => m.type !== "exact");
  const total = reviewable.length + composites.length;
  const pending =
    reviewable.filter((m) => m.status === "suggested").length +
    composites.filter((c) => c.status === "suggested").length;
  return { total, decided: total - pending, pending };
}
