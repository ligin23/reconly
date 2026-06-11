// One-off demo: prints fuzzy scores for example description pairs.
// Run: npx tsx scripts/fuzzy-score-demo.ts
import { normalize } from "../src/lib/recon/normalize";
import {
  descriptionSimilarity,
  fuzzyDescriptionSimilarity,
  stripNoiseTokens,
} from "../src/lib/recon/similarity";
import {
  computeFuzzyConfidence,
  FUZZY_DESC_FLOOR,
  NEAR_DESC_THRESHOLD,
} from "../src/lib/recon/engine";

const pairs: Array<[string, string]> = [
  ["SQ *BLUE BOTTLE COFFEE", "Blue Bottle Coffee"],
  ["STARBUCKS STORE 04412", "Starbucks"],
  ["PAYPAL *JOHNSPLUMBING", "John's Plumbing"],
  ["WHOLEFDS MKT US*7X1", "Whole Foods Market"],
  ["POS DEBIT 9921 STARBUCKS RESERVE 04412 SEATTLE WA REF 2200391", "Starbucks coffee"],
  ["TST* HMSTD CAFE 0042 OAKLAND CA", "Homestead Cafe"],
  ["ACH PMT VERIZON WIRELESS 884412", "Verizon"],
  ["WMT US*2K4LP9", "Walmart"],
  ["CEDAR BANK FEE", "HARBORLINE CONSULTING"],
  ["TST* PIZZERIA OTTO 0042", "Lakeside Hardware"],
  ["POS DEBIT 04412", "ACH 99812"],
];

const rows = pairs.map(([a, b]) => {
  const na = normalize(a);
  const nb = normalize(b);
  const raw = descriptionSimilarity(na, nb);
  const fz = fuzzyDescriptionSimilarity(na, nb);
  return {
    bank: a,
    ledger: b,
    cleanedBank: stripNoiseTokens(na) || "(all noise)",
    cleanedLedger: stripNoiseTokens(nb) || "(all noise)",
    rawSim: raw.toFixed(3),
    nearTier: raw >= NEAR_DESC_THRESHOLD ? "yes" : "no",
    fuzzyScore: fz.toFixed(3),
    aboveFloor: fz >= FUZZY_DESC_FLOOR ? "yes" : "no",
    "conf@0d": fz >= FUZZY_DESC_FLOOR ? computeFuzzyConfidence(0, fz) : "—",
    "conf@3d": fz >= FUZZY_DESC_FLOOR ? computeFuzzyConfidence(3, fz) : "—",
    "conf@5d": fz >= FUZZY_DESC_FLOOR ? computeFuzzyConfidence(5, fz) : "—",
  };
});

console.log(`NEAR_DESC_THRESHOLD=${NEAR_DESC_THRESHOLD}  FUZZY_DESC_FLOOR=${FUZZY_DESC_FLOOR}`);
console.table(rows);
