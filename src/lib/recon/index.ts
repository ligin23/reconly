// Public surface of the reconciliation engine.
// Import from here, not from sub-modules directly.

export {
  reconcile,
  findCompositeMatches,
  enrichReasons,
  computeFuzzyConfidence,
  DATE_WINDOW,
  NEAR_DESC_THRESHOLD,
  FUZZY_DESC_FLOOR,
  COMPOSITE_DATE_WINDOW,
  COMPOSITE_MIN_GROUP,
  COMPOSITE_MAX_GROUP,
} from "./engine";
export { normalize } from "./normalize";
export {
  descriptionSimilarity,
  fuzzyDescriptionSimilarity,
  stripNoiseTokens,
  RAIL_PREFIX_TOKENS,
  NOISE_WORDS,
  LOCATION_SUFFIX_TOKENS,
} from "./similarity";
export type {
  Txn,
  Match,
  MatchType,
  MatchStatus,
  ReconResult,
  BalanceProof,
  ReasonDetail,
  CompositeMatch,
  AmbiguousCompositeMatch,
  AnyCompositeMatch,
} from "./types";

export { toCompositeReviewItem } from "./adapter";
