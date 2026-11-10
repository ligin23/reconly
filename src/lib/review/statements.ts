// ============================================================
// Reconly — statement balance verification
// Pure TypeScript. Deterministic. Entirely separate from the matching
// engine: it never matches anything and is never consulted by matching.
//
// QUESTION IT ANSWERS (per uploaded bank file)
//   Do the balances the file itself states agree with the transactions
//   the file itself contains?
//       opening balance + net activity = closing balance
//
// WHAT IT USES
//   Imported statement values only: every row read from the file
//   (INCLUDING rows later set aside as repeated — setting a row aside for
//   the reconciliation must not change what the original statement
//   proves), the opening / closing balances the file states, and the
//   running balance printed on each row. All arithmetic is in integer
//   cents. Nothing is ever filled in: a balance that is calculated (for
//   example an opening balance worked back from the first running
//   balance) is labelled "calculated", and never treated as stated.
//
// SIGN CONVENTION — established by evidence, never chosen to fit
//   Amounts are signed the way the rest of Reconly reads them (money out
//   is negative). On a deposit account the balance falls when money goes
//   out ("standard"); on a credit-card or loan statement the balance is an
//   amount owed and RISES when money goes out ("owed"). The "owed" reading
//   is used ONLY when (a) the file's own running balance shows it, or
//   (b) the file says so explicitly (a title line or balance-column title
//   such as "Credit card", "Amount owed", "Balance due"). If stated
//   opening and closing balances agree only under the "owed" reading and
//   neither (a) nor (b) holds, the statement is NOT verified: the sign
//   convention needs review. Reconly never picks whichever convention
//   happens to make the numbers balance.
//
// TWO KINDS OF POSITIVE EVIDENCE — kept apart
//   verified            "Statement balance verified": the file STATES both
//                       an opening and a closing balance, and its activity
//                       supports them, with no contradiction.
//   running-consistent  "Running balance consistency verified": every
//                       row's running balance follows from the one before.
//                       The rows are internally consistent, but an opening
//                       or closing balance may be calculated rather than
//                       stated — so this is NOT independent verification
//                       of the statement's stated balances.
//
// OTHER STATUSES
//   mismatch          — "Statement balance mismatch" (exact difference)
//   convention-review — "Sign convention needs review"
//   conflict          — "Conflicting statement evidence"
//   insufficient      — "Not verified — insufficient statement information"
// None of these says the books are reconciled.
// ============================================================

import type { Txn } from "@/lib/recon/types";
import type { SourceFileInfo } from "@/lib/data/repository";
import { accountOf } from "@/lib/import/duplicates";

export type StatementStatus =
  | "verified"
  | "running-consistent"
  | "mismatch"
  | "convention-review"
  | "insufficient"
  | "conflict";

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = {
  verified: "Statement balance verified",
  "running-consistent": "Running balance consistency verified",
  mismatch: "Statement balance mismatch",
  "convention-review": "Sign convention needs review",
  insufficient: "Not verified — insufficient statement information",
  conflict: "Conflicting statement evidence",
};

/** Statuses that mean something is wrong or unresolved in the evidence. */
export const STATEMENT_NEEDS_REVIEW: readonly StatementStatus[] = ["mismatch", "conflict", "convention-review"];

const emptyCounts = (): Record<StatementStatus, number> => ({
  verified: 0,
  "running-consistent": 0,
  mismatch: 0,
  "convention-review": 0,
  insufficient: 0,
  conflict: 0,
});

/**
 * The statement evidence for the whole reconciliation, in one word:
 *   review-needed        a mismatch, a conflict, or an unsettled sign convention
 *   verified             every bank file's stated balances are verified
 *   partly-verified      some are; others are consistency-only or not verified
 *   running-balance-only no stated balances verified; running balances are consistent
 *   not-verified         no usable statement evidence (not, by itself, an error)
 */
export type StatementSummary =
  | "review-needed"
  | "verified"
  | "partly-verified"
  | "running-balance-only"
  | "not-verified";

export const STATEMENT_SUMMARY_LABEL: Record<StatementSummary, string> = {
  "review-needed": "Statement review needed",
  verified: "Statement balances verified",
  "partly-verified": "Statement balances verified for some files only",
  "running-balance-only": "Running balance consistent — stated balances not verified",
  "not-verified": "Not verified",
};

export function statementIssueCount(counts: Record<StatementStatus, number>): number {
  return counts.mismatch + counts.conflict + counts["convention-review"];
}

export function summarizeStatements(counts: Record<StatementStatus, number>): StatementSummary {
  if (statementIssueCount(counts) > 0) return "review-needed";
  const other = counts["running-consistent"] + counts.insufficient;
  if (counts.verified > 0) return other === 0 ? "verified" : "partly-verified";
  if (counts["running-consistent"] > 0) return "running-balance-only";
  return "not-verified";
}

/** A balance used in a check, and where it came from. */
export type BalanceValue = {
  cents: number;
  /** "stated" = read from the file as an opening/closing balance;
   *  "running" = the running balance printed on a row;
   *  "calculated" = worked out from a running balance — never stated. */
  source: "stated" | "running" | "calculated";
  /** 1-based line in the file, when it corresponds to one. */
  line?: number;
};

export type StatementCheck = {
  file: string;
  /** Account identifier found in the file's rows, or null if none. */
  account: string | null;
  /** Period the file states for itself (title line), if any. */
  statedPeriod: { start: string; end: string } | null;
  /** First / last transaction date among the file's rows. */
  activity: { start: string; end: string } | null;
  /** Rows read from the file — all of them, set aside or not. */
  rowCount: number;
  /** Signed cents: sum of every row read from the file. */
  netActivity: number;
  opening: BalanceValue | null;
  closing: BalanceValue | null;
  /** How balances move in this file; "unknown" when nothing shows it. */
  convention: "standard" | "owed" | "unknown";
  /** What the check rests on. */
  basis: ("stated-balances" | "running-balance")[];
  /** closing implied by opening and activity − closing shown (cents).
   *  0 when verified; the exact gap on a mismatch; null when not computable. */
  difference: number | null;
  status: StatementStatus;
  /** Plain-language reasons, most important first. */
  reasons: string[];
};

export type StatementReview = {
  statements: StatementCheck[];
  /** Pairs of files whose date ranges overlap (reported, not a failure). */
  overlaps: { fileA: string; fileB: string; start: string; end: string }[];
  counts: Record<StatementStatus, number>;
};

const money = (cents: number): string => {
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${s}` : `$${s}`;
};
const niceDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

type Running = {
  /** +1: balance moves with the amount (standard); −1: against it (owed). */
  sign: 1 | -1;
  /** Rows oldest-first. */
  chronological: Txn[];
};

/**
 * Does every row's running balance follow from the previous row's balance
 * and its own amount? Tried oldest-first and newest-first, and with both
 * sign conventions; the file's own numbers pick the one that fits.
 */
function readRunning(rows: Txn[]): { ok: Running | null; firstBreak: { row: Txn; expected: number; shown: number } | null } {
  const variants: Running[] = [];
  for (const order of [rows, [...rows].reverse()]) {
    for (const sign of [1, -1] as const) variants.push({ sign, chronological: order });
  }
  let best: { breaks: number; firstBreak: { row: Txn; expected: number; shown: number } | null } | null = null;
  for (const v of variants) {
    let breaks = 0;
    let firstBreak: { row: Txn; expected: number; shown: number } | null = null;
    for (let i = 1; i < v.chronological.length; i++) {
      const prev = v.chronological[i - 1];
      const row = v.chronological[i];
      const expected = prev.runningBalance! + v.sign * row.amount;
      if (expected !== row.runningBalance) {
        breaks++;
        if (!firstBreak) firstBreak = { row, expected, shown: row.runningBalance! };
      }
    }
    if (breaks === 0) return { ok: v, firstBreak: null };
    if (!best || breaks < best.breaks) best = { breaks, firstBreak };
  }
  return { ok: null, firstBreak: best?.firstBreak ?? null };
}

function checkFile(file: SourceFileInfo, rows: Txn[]): StatementCheck {
  const accounts = [...new Set(rows.map((r) => accountOf(r)).filter(Boolean))];
  const dates = rows.map((r) => r.date).sort();
  const netActivity = rows.reduce((s, r) => s + r.amount, 0);
  const statedOpening = file.statementOpening ?? null;
  const statedClosing = file.statementClosing ?? null;

  const check: StatementCheck = {
    file: file.name,
    account: accounts.length === 1 ? accounts[0] : null,
    statedPeriod:
      file.statementStart && file.statementEnd ? { start: file.statementStart, end: file.statementEnd } : null,
    activity: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    rowCount: rows.length,
    netActivity,
    opening: statedOpening ? { cents: statedOpening.cents, source: "stated", line: statedOpening.line } : null,
    closing: statedClosing ? { cents: statedClosing.cents, source: "stated", line: statedClosing.line } : null,
    convention: "unknown",
    basis: [],
    difference: null,
    status: "insufficient",
    reasons: [],
  };
  const done = (status: StatementStatus, ...reasons: string[]): StatementCheck => ({
    ...check,
    status,
    reasons: [...reasons, ...check.reasons],
  });

  // ---- Reasons the file cannot be checked at all --------------------
  if ((file.statementAmbiguities ?? []).length > 0) {
    return done(
      "conflict",
      "The file's balance information is unclear, so it was not used: " + file.statementAmbiguities!.join(" ")
    );
  }
  if (accounts.length > 1) {
    return done(
      "insufficient",
      `This file has rows for ${accounts.length} different accounts (${accounts.slice(0, 3).join(", ")}${accounts.length > 3 ? ", …" : ""}). Balances from different accounts are never combined, so the file was not checked.`
    );
  }
  if ((file.skippedRows ?? 0) > 0) {
    return done(
      "insufficient",
      `${file.skippedRows} row${file.skippedRows === 1 ? "" : "s"} in this file could not be read, so its activity is incomplete and its balances cannot be checked against it.`
    );
  }

  // ---- Running balance, when every row carries one -------------------
  const withBalance = rows.filter((r) => r.runningBalance !== undefined);
  let running: Running | null = null;
  if (withBalance.length > 0 && withBalance.length < rows.length) {
    check.reasons.push(
      `Only ${withBalance.length} of ${rows.length} rows show a running balance, so the running balance was not used.`
    );
  } else if (rows.length >= 2 && withBalance.length === rows.length) {
    const r = readRunning(rows);
    if (!r.ok) {
      const b = r.firstBreak!;
      return {
        ...check,
        basis: ["running-balance"],
        difference: b.expected - b.shown,
        status: "mismatch",
        reasons: [
          `The running balance does not follow from the amounts at row ${b.row.sourceLine ?? "?"} (${niceDate(b.row.date)}, ${b.row.description}): the previous balance and this amount give ${money(b.expected)}, but the file shows ${money(b.shown)} — a difference of ${money(b.expected - b.shown)}. A transaction may be missing from the file, or a row may have changed.`,
        ],
      };
    }
    running = r.ok;
    check.basis.push("running-balance");
    check.convention = running.sign === 1 ? "standard" : "owed";
  } else if (rows.length === 1 && withBalance.length === 1) {
    check.reasons.push("The file has a single row, so its running balance cannot be cross-checked.");
  }

  const conventionNote = (c: "standard" | "owed") =>
    c === "owed"
      ? " In this file the balance rises when money goes out — as on a credit-card or loan statement, where the balance is an amount owed."
      : "";

  if (running) {
    const first = running.chronological[0];
    const last = running.chronological[running.chronological.length - 1];
    const impliedOpening = first.runningBalance! - running.sign * first.amount;
    const lastBalance = last.runningBalance!;

    // Stated balances must agree with what the running balance shows.
    if (statedOpening && statedOpening.cents !== impliedOpening) {
      return {
        ...check,
        difference: statedOpening.cents - impliedOpening,
        status: "mismatch",
        reasons: [
          `The file states an opening balance of ${money(statedOpening.cents)} (line ${statedOpening.line}), but its first row's running balance implies ${money(impliedOpening)} — a difference of ${money(statedOpening.cents - impliedOpening)}. Transactions at the start of the period may be missing from the file.`,
        ],
      };
    }
    if (statedClosing && statedClosing.cents !== lastBalance) {
      return {
        ...check,
        difference: lastBalance - statedClosing.cents,
        status: "mismatch",
        reasons: [
          `The file states a closing balance of ${money(statedClosing.cents)} (line ${statedClosing.line}), but its last row shows a running balance of ${money(lastBalance)} — a difference of ${money(lastBalance - statedClosing.cents)}. Transactions at the end of the period may be missing from the file.`,
        ],
      };
    }
    if (statedOpening || statedClosing) check.basis.unshift("stated-balances");
    const bothStated = Boolean(statedOpening && statedClosing);
    return {
      ...check,
      opening: check.opening ?? { cents: impliedOpening, source: "calculated" },
      closing: check.closing ?? { cents: lastBalance, source: "running", line: last.sourceLine },
      difference: 0,
      // Stated opening AND closing, supported by the activity → the
      // statement's balances are verified. Anything less is internal
      // consistency only, and is labelled as such.
      status: bothStated ? "verified" : "running-consistent",
      reasons: [
        (bothStated
          ? `The file states an opening and a closing balance, and its activity supports both: every row's running balance follows from the one before it across all ${rows.length} rows.`
          : `Every row's running balance follows from the one before it across all ${rows.length} rows, so the file's rows are internally consistent. ` +
            (statedOpening
              ? "The stated opening balance agrees with it, but the file states no closing balance (the one shown is the last running balance)."
              : statedClosing
                ? "The stated closing balance agrees with it, but the file states no opening balance (the one shown is calculated from the first row)."
                : "The file states no opening or closing balance (the opening shown is calculated from the first row; the closing is the last running balance).") +
            " This is not independent verification of a stated opening and closing balance.") +
          conventionNote(check.convention as "standard" | "owed"),
        ...check.reasons,
      ],
    };
  }

  // ---- Stated opening + closing only ---------------------------------
  if (statedOpening && statedClosing) {
    check.basis.push("stated-balances");
    const standard = statedOpening.cents + netActivity - statedClosing.cents;
    const owed = statedOpening.cents - netActivity - statedClosing.cents;
    if (standard === 0) {
      return {
        ...check,
        convention: "standard",
        difference: 0,
        status: "verified",
        reasons: [
          `Opening balance ${money(statedOpening.cents)} plus the file's net activity of ${money(netActivity)} equals the closing balance ${money(statedClosing.cents)}.`,
          ...check.reasons,
        ],
      };
    }
    if (owed === 0 && netActivity !== 0) {
      // The balances agree only if they are amounts owed. That reading is
      // accepted when the FILE says so — never because it makes the sum work.
      const said = file.statementOwedIndication;
      if (said) {
        return {
          ...check,
          convention: "owed",
          difference: 0,
          status: "verified",
          reasons: [
            `The file says its balances are amounts owed ("${said.text}", line ${said.line}). Opening balance ${money(statedOpening.cents)} less the file's net activity of ${money(netActivity)} equals the closing balance ${money(statedClosing.cents)}.` +
              conventionNote("owed"),
            ...check.reasons,
          ],
        };
      }
      return {
        ...check,
        difference: standard,
        status: "convention-review",
        reasons: [
          `Opening balance ${money(statedOpening.cents)} plus the file's net activity of ${money(netActivity)} gives ${money(statedOpening.cents + netActivity)}, not the stated closing balance of ${money(statedClosing.cents)} — a difference of ${money(standard)}. The balances WOULD agree if they are amounts owed (as on a credit-card or loan statement), but the file does not say so and has no running balance to show it. The sign convention needs review; until then this statement is not verified.`,
          ...check.reasons,
        ],
      };
    }
    return {
      ...check,
      difference: standard,
      status: "mismatch",
      reasons: [
        `Opening balance ${money(statedOpening.cents)} plus the file's net activity of ${money(netActivity)} gives ${money(statedOpening.cents + netActivity)}, but the file states a closing balance of ${money(statedClosing.cents)} — a difference of ${money(standard)}. Transactions may be missing from the file, or a balance may have been entered incorrectly. (Reading the balance as an amount owed does not make it agree either.)`,
        ...check.reasons,
      ],
    };
  }

  // ---- Not enough to check -------------------------------------------
  const have = statedOpening ? "only an opening balance" : statedClosing ? "only a closing balance" : null;
  return done(
    "insufficient",
    have
      ? `The file states ${have} and has no running balance, so there is nothing to check it against.`
      : "The file states no opening or closing balance and has no usable running balance, so its activity could not be verified."
  );
}

/** Balance at the end of each day, from a verified running balance. */
function endOfDayBalances(rows: Txn[]): Map<string, number> | null {
  if (rows.length < 2 || rows.some((r) => r.runningBalance === undefined)) return null;
  const r = readRunning(rows);
  if (!r.ok) return null;
  const out = new Map<string, number>();
  for (const row of r.ok.chronological) out.set(row.date, row.runningBalance!);
  return out;
}

/**
 * Verify every uploaded BANK file against its own stated balances.
 *
 * @param bankRows     every imported bank row, including rows set aside
 * @param sourceFiles  file-level facts captured at import (may be absent
 *                     for older saved reconciliations → no statements)
 */
export function verifyStatements(bankRows: Txn[], sourceFiles: SourceFileInfo[] | undefined): StatementReview {
  const files = (sourceFiles ?? []).filter((f) => f.side === "bank");
  const rowsByFile = new Map<string, Txn[]>();
  for (const r of bankRows) {
    if (!r.sourceFile) continue;
    const list = rowsByFile.get(r.sourceFile);
    if (list) list.push(r);
    else rowsByFile.set(r.sourceFile, [r]);
  }

  const statements = files.map((f) => checkFile(f, rowsByFile.get(f.name) ?? []));
  const overlaps: StatementReview["overlaps"] = [];
  const conflict = (i: number, reason: string) => {
    const s = statements[i];
    statements[i] = { ...s, status: "conflict", reasons: [reason, ...s.reasons] };
  };
  const range = (s: StatementCheck) => s.statedPeriod ?? s.activity;

  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i];
      const b = statements[j];
      // Balances from different accounts are never compared or combined.
      if ((a.account ?? "") !== (b.account ?? "")) continue;
      const ra = range(a);
      const rb = range(b);
      if (!ra || !rb) continue;

      const start = ra.start > rb.start ? ra.start : rb.start;
      const end = ra.end < rb.end ? ra.end : rb.end;
      if (start <= end) {
        overlaps.push({ fileA: a.file, fileB: b.file, start, end });
        // Same stated period, different stated balances.
        if (a.statedPeriod && b.statedPeriod && a.statedPeriod.start === b.statedPeriod.start && a.statedPeriod.end === b.statedPeriod.end) {
          for (const kind of ["opening", "closing"] as const) {
            const x = a[kind];
            const y = b[kind];
            if (x?.source === "stated" && y?.source === "stated" && x.cents !== y.cents) {
              const msg = `"${a.file}" and "${b.file}" state the same period but different ${kind} balances (${money(x.cents)} and ${money(y.cents)}).`;
              conflict(i, msg);
              conflict(j, msg);
            }
          }
        }
        // Same day, different end-of-day running balance.
        const ea = endOfDayBalances(rowsByFile.get(a.file) ?? []);
        const eb = endOfDayBalances(rowsByFile.get(b.file) ?? []);
        if (ea && eb) {
          for (const [date, bal] of ea) {
            const other = eb.get(date);
            if (other !== undefined && other !== bal) {
              const msg = `"${a.file}" and "${b.file}" overlap and disagree: on ${niceDate(date)} one shows a balance of ${money(bal)} and the other ${money(other)}.`;
              conflict(i, msg);
              conflict(j, msg);
              break;
            }
          }
        }
        continue;
      }

      // Back-to-back stated periods: one statement's closing balance must
      // be the next one's opening balance.
      if (a.statedPeriod && b.statedPeriod) {
        const [first, second, fi, si] =
          a.statedPeriod.end < b.statedPeriod.start ? [a, b, i, j] : [b, a, j, i];
        if (addDays(first.statedPeriod!.end, 1) === second.statedPeriod!.start && first.closing && second.opening) {
          if (first.closing.cents !== second.opening.cents) {
            const msg = `"${first.file}" closes at ${money(first.closing.cents)} but "${second.file}", which starts the next day, opens at ${money(second.opening.cents)} — a difference of ${money(second.opening.cents - first.closing.cents)}.`;
            conflict(fi, msg);
            conflict(si, msg);
          }
        }
      }
    }
  }

  const counts = emptyCounts();
  for (const s of statements) counts[s.status]++;
  return { statements, overlaps, counts };
}

// ---- Month view -------------------------------------------------------

export type MonthStatementStatus =
  | "verified"
  | "partly-verified"
  | "running-consistent"
  | "mismatch"
  | "convention-review"
  | "conflict"
  | "insufficient";

export const MONTH_STATEMENT_LABEL: Record<MonthStatementStatus, string> = {
  verified: "Statement balance verified",
  "partly-verified": "Statement balance verified for part of the month",
  "running-consistent": "Running balance consistent — stated balances not verified",
  mismatch: "Statement balance mismatch",
  "convention-review": "Sign convention needs review",
  conflict: "Conflicting statement evidence",
  insufficient: "Not verified — insufficient statement information",
};

export type MonthStatement = {
  status: MonthStatementStatus;
  label: string;
  /** One sentence saying what the status rests on. */
  detail: string;
  /** Statements with rows or a stated period in this month. */
  statements: StatementCheck[];
};

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * What the statement evidence says about one calendar month.
 *
 * A month is "verified" only when (1) statements whose STATED balances are
 * verified, and which state their period, cover every day of it, AND
 * (2) every other bank file with rows in the month is also verified. If
 * another relevant file is consistency-only or not verified, the month is
 * "verified for part of the month", saying which evidence is which. A
 * verified file with no stated period proves only the stretch between its
 * first and last row. Running-balance consistency on its own never makes a
 * month "verified".
 */
export function monthStatement(review: StatementReview, month: string): MonthStatement {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const touching = review.statements.filter((s) => {
    const r = s.statedPeriod ?? s.activity;
    return r !== null && r.start <= last && r.end >= first;
  });
  const make = (status: MonthStatementStatus, detail: string): MonthStatement => ({
    status,
    label: MONTH_STATEMENT_LABEL[status],
    detail,
    statements: touching,
  });
  const names = (list: StatementCheck[]) => list.map((s) => `"${s.file}"`).join(", ");

  if (touching.length === 0) {
    return make("insufficient", "No uploaded bank file with balance information covers this month.");
  }
  const by = (status: StatementStatus) => touching.filter((s) => s.status === status);
  if (by("conflict").length > 0) return make("conflict", `Conflicting evidence in ${names(by("conflict"))}.`);
  if (by("mismatch").length > 0) return make("mismatch", `Balances do not agree with activity in ${names(by("mismatch"))}.`);
  if (by("convention-review").length > 0) {
    return make(
      "convention-review",
      `${names(by("convention-review"))}: the balances agree only if they are amounts owed, and the file does not establish that.`
    );
  }

  const verified = by("verified");
  const consistent = by("running-consistent");
  const unchecked = by("insufficient");
  const span = (s: StatementCheck) => {
    const r = s.statedPeriod ?? s.activity!;
    const from = r.start < first ? first : r.start;
    const to = r.end > last ? last : r.end;
    return `${niceDate(from)} to ${niceDate(to)} ("${s.file}"${s.statedPeriod ? "" : ", from its first to its last row — the file states no period"})`;
  };

  if (verified.length === 0) {
    if (consistent.length > 0) {
      return make(
        "running-consistent",
        `Running balances are internally consistent for ${consistent.map(span).join("; ")}. No stated opening and closing balance was verified for this month.` +
          (unchecked.length > 0 ? ` Not checked: ${names(unchecked)}.` : "")
      );
    }
    return make("insufficient", `${names(touching)} ${touching.length === 1 ? "does" : "do"} not carry enough balance information to check.`);
  }

  // Days of the month covered by verified statements that state their period.
  const stated = verified
    .filter((s) => s.statedPeriod)
    .map((s) => s.statedPeriod!)
    .sort((a, b) => a.start.localeCompare(b.start));
  let coveredThrough = addDays(first, -1);
  for (const p of stated) {
    if (p.start <= addDays(coveredThrough, 1) && p.end > coveredThrough) coveredThrough = p.end;
  }
  const others = [...consistent, ...unchecked];
  if (coveredThrough >= last && others.length === 0) {
    return make("verified", `Verified statements stating their own period cover every day of the month (${names(verified)}).`);
  }
  if (coveredThrough >= last) {
    // Every day is covered by a verified statement, but another bank file
    // with rows in this month is not verified — so not all of the month's
    // bank rows sit under a verified statement.
    const parts = [
      `Verified: ${names(verified)}.`,
      consistent.length > 0 ? `Running balance consistent only (stated balances not verified): ${names(consistent)}.` : "",
      unchecked.length > 0 ? `Not checked: ${names(unchecked)} (not enough balance information).` : "",
      "So some of this month's bank rows are not covered by a verified statement.",
    ].filter(Boolean);
    return make("partly-verified", parts.join(" "));
  }
  return make(
    "partly-verified",
    `Statement evidence covers ${verified.map(span).join("; ")}. The rest of the month is not covered by a verified statement.` +
      (consistent.length > 0 ? ` Running balance consistent only: ${names(consistent)}.` : "") +
      (unchecked.length > 0 ? ` Not checked: ${names(unchecked)}.` : "")
  );
}
