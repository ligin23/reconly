// Public surface of the reconciliation engine.
// Import from here, not from sub-modules directly.

export { reconcile, enrichReasons, DATE_WINDOW, NEAR_DESC_THRESHOLD } from "./engine";
export { normalize } from "./normalize";
export { descriptionSimilarity } from "./similarity";
export type {
  Txn,
  Match,
  MatchType,
  MatchStatus,
  ReconResult,
  BalanceProof,
  ReasonDetail,
} from "./types";
