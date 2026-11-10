// ============================================================
// Reconly — duplicate and overlap detection
// Pure TypeScript. No React. Deterministic: same rows in, same answer out.
//
// Sits in FRONT of the matching engine and never changes it. It looks at
// the rows imported for ONE side (bank, or ledger — never one against the
// other: bank-vs-ledger is what reconciliation is for) and reports rows
// that look like the same source row imported more than once.
//
// WHAT IT MAY DO ON ITS OWN
//   Only one thing: when the files themselves prove two rows in DIFFERENT
//   files are the same transaction (see "strong evidence" below), the later
//   copy is proposed for automatic set-aside. A set-aside row is never
//   deleted — it stays in the import, is shown with its reason, file and
//   row number, and can be restored with one click.
//
// WHAT IT NEVER DOES
//   - never sets aside anything on date + amount + description alone;
//   - never sets aside a row because of a repeat inside the SAME file;
//   - never infers duplicates from overlapping date ranges;
//   - never removes a row from the import.
//
// EVIDENCE (applied to two rows with the same date and the same amount)
//   Different files:
//     1. Both rows carry a transaction ID (a dedicated ID column, unique
//        within its own file):  equal  → STRONG;  different → not duplicates.
//        An equal ID overrides a DIFFERENT description only when the
//        account also agrees (same on both rows, or no account column on
//        either); if only one row names an account → POSSIBLE.
//     2. else both carry a running balance (and the amount isn't zero):
//        equal + same description → STRONG; equal, description differs →
//        POSSIBLE; different → not duplicates.
//     3. else both carry a reference / check number (unique in its file):
//        equal + same description → STRONG, but only when the reference is
//        RELIABLE on both rows: it comes from a real reference / check
//        column (not a bare "id" / "#" column, which may be a row counter),
//        contains a digit, is at least 3 characters, and at least 90% of
//        the references in its file are distinct. Otherwise → POSSIBLE.
//        Equal, description differs → POSSIBLE; different + same
//        description → POSSIBLE (reference numbering is not reliable
//        enough across exports to PROVE two rows are different).
//     Running balances are only ever read from a balance column in the
//     uploaded file — Reconly never computes one to use as evidence.
//     4. else (nothing in the files can tell): same description → POSSIBLE;
//        different description → not duplicates.
//     An account column present on both rows with different values rules
//     the pair out entirely.
//     A row that already has a STRONG partner in another file is not also
//     flagged as a POSSIBLE duplicate of other rows in that same file.
//   Same file (description must also match):
//     ID / running balance / reference present on both: equal → POSSIBLE
//     (flag), different → not duplicates. None present → POSSIBLE.
//     Same-file repeats are only ever flagged.
//
//   STRONG  → later copy is set aside automatically (reversible).
//   POSSIBLE → every row stays in use; the group is flagged for the user.
// ============================================================

import { normalize } from "@/lib/recon/normalize";
import type { Txn } from "@/lib/recon/types";

export type DuplicateSide = "bank" | "ledger";

export type EvidenceCode =
  | "transaction-id"            // strong
  | "transaction-id-account-unconfirmed" // possible — descriptions differ, account not confirmable
  | "reference-not-reliable"    // possible — equal reference, but not trustworthy enough
  | "running-balance"           // strong
  | "reference"                 // strong
  | "balance-description-differs"   // possible
  | "reference-description-differs" // possible
  | "reference-differs"         // possible — same values, different reference
  | "values-only"               // possible — no column can tell
  | "same-file-same-id"         // possible — repeated inside one file
  | "same-file-same-balance"
  | "same-file-same-reference"
  | "same-file-values-only";

export type DuplicateEvidence = { code: EvidenceCode; strong: boolean; text: string };

export type DuplicateGroup = {
  /** Stable for a given import: derived from the first row's id. */
  id: string;
  side: DuplicateSide;
  /** "cross-file" when the rows come from more than one file. */
  kind: "within-file" | "cross-file";
  /** Every row in the group, in import order. */
  txnIds: string[];
  /** Rows the evidence is strong enough to set aside automatically. */
  autoSetAsideIds: string[];
  /**
   * What "set aside the repeats" would set aside if the user agrees
   * (always includes autoSetAsideIds). Empty when the files disagree on how
   * many times the transaction appears, so no row can be singled out.
   */
  suggestedSetAsideIds: string[];
  evidence: DuplicateEvidence[];
  /** Source files involved ("" for rows with no recorded file). */
  files: string[];
};

// ---- Evidence columns ------------------------------------------------
// Header names are compared lower-cased and trimmed (the parser already
// stores raw rows that way).

const TRUE_ID_HEADERS = [
  "transaction id", "transaction_id", "transactionid", "txn id", "txn_id", "txnid",
  "trans id", "trans_id", "transaction number", "transaction no", "transaction #",
  "fitid", "unique id", "unique identifier",
];
/** A bare "id" column may be a transaction ID or just a row counter, so it
 *  is only trusted as much as a reference number. */
const GENERIC_ID_HEADERS = ["id", "no", "no.", "#"];
const REFERENCE_HEADERS = [
  "reference", "ref", "reference number", "ref number", "reference no", "ref no",
  "check #", "check number", "check no", "check", "chk", "cheque number", "cheque no",
];
const BALANCE_HEADERS = ["balance", "running balance", "running bal", "running bal.", "bal"];
const ACCOUNT_HEADERS = [
  "account", "account number", "account #", "account no", "account id", "account name",
];

function pick(raw: Record<string, string>, headers: string[]): string {
  for (const h of headers) {
    const v = raw[h];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

/** The account identifier a row carries in its own columns ("" if none). */
export function accountOf(txn: Pick<Txn, "raw">): string {
  return pick(txn.raw ?? {}, ACCOUNT_HEADERS);
}

/** Balances are compared as amounts where possible ("1,234.50" = "$1234.5"). */
function canonicalBalance(v: string): string {
  if (!v) return "";
  const stripped = v.replace(/[$£€¥,\s]/g, "");
  const negative = /^\(.*\)$/.test(stripped) || /^-/.test(stripped) || /-$/.test(stripped);
  const n = Number(stripped.replace(/[()\-]/g, ""));
  if (!Number.isFinite(n)) return v;
  return String((negative ? -1 : 1) * Math.round(n * 100));
}

type Row = {
  txn: Txn;
  index: number;
  file: string;
  /** Normalized description; falls back to the trimmed lower-cased text
   *  when normalization leaves nothing (punctuation-only descriptions). */
  desc: string;
  trueId: string;
  ref: string;
  balance: string;
  account: string;
  /** trueId / ref is non-empty AND appears once in its own file. */
  idUnique: boolean;
  refUnique: boolean;
  /** ref came from a bare "id" / "#" column (possibly just a row counter). */
  refGeneric: boolean;
  /** ref is trustworthy enough to PROVE a duplicate (see header comment). */
  refReliable: boolean;
};

/** Share of a file's references that must be distinct for the column to
 *  be treated as an identifier rather than a label ("ACH", "POS"…). */
const REFERENCE_DISTINCT_SHARE = 0.9;

function toRows(txns: Txn[]): Row[] {
  const rows: Row[] = txns.map((txn, index) => {
    const raw = txn.raw ?? {};
    const realRef = (txn.reference ?? "").trim() || pick(raw, REFERENCE_HEADERS);
    const genericRef = realRef ? "" : pick(raw, GENERIC_ID_HEADERS);
    return {
      txn,
      index,
      file: txn.sourceFile ?? "",
      desc: normalize(txn.description) || txn.description.trim().toLowerCase(),
      trueId: pick(raw, TRUE_ID_HEADERS),
      ref: realRef || genericRef,
      refGeneric: !realRef && genericRef !== "",
      refReliable: false,
      // Read from the uploaded file's own balance column — never computed.
      balance: txn.amount === 0 ? "" : canonicalBalance(pick(raw, BALANCE_HEADERS)),
      account: pick(raw, ACCOUNT_HEADERS).toLowerCase(),
      idUnique: false,
      refUnique: false,
    };
  });
  const count = (key: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const idCounts = count((r) => (r.trueId ? `${r.file}\u0000${r.trueId}` : ""));
  const refCounts = count((r) => (r.ref ? `${r.file}\u0000${r.ref}` : ""));
  // Per file: how many rows carry a reference, and how many distinct values.
  const refTotals = new Map<string, { total: number; distinct: Set<string> }>();
  for (const r of rows) {
    if (!r.ref) continue;
    const t = refTotals.get(r.file) ?? { total: 0, distinct: new Set<string>() };
    t.total++;
    t.distinct.add(r.ref);
    refTotals.set(r.file, t);
  }
  for (const r of rows) {
    r.idUnique = r.trueId !== "" && idCounts.get(`${r.file}\u0000${r.trueId}`) === 1;
    r.refUnique = r.ref !== "" && refCounts.get(`${r.file}\u0000${r.ref}`) === 1;
    const t = refTotals.get(r.file);
    r.refReliable =
      r.refUnique &&
      !r.refGeneric &&
      r.ref.length >= 3 &&
      /\d/.test(r.ref) &&
      t !== undefined &&
      t.distinct.size / t.total >= REFERENCE_DISTINCT_SHARE;
  }
  return rows;
}

type Link = { code: EvidenceCode; strong: boolean } | null;

function crossFileLink(a: Row, b: Row): Link {
  if (a.account && b.account && a.account !== b.account) return null;
  const sameDesc = a.desc === b.desc;
  if (a.idUnique && b.idUnique) {
    if (a.trueId !== b.trueId) return null;
    // Date, amount and side already agree (only such rows are compared).
    // A matching ID may override a different description only when the
    // account agrees too: the same on both rows, or absent from both. (A
    // differing account was ruled out above.)
    if (sameDesc || a.account === b.account) return { code: "transaction-id", strong: true };
    return { code: "transaction-id-account-unconfirmed", strong: false };
  }
  if (a.balance && b.balance) {
    if (a.balance !== b.balance) return null;
    return sameDesc
      ? { code: "running-balance", strong: true }
      : { code: "balance-description-differs", strong: false };
  }
  if (a.refUnique && b.refUnique) {
    if (a.ref !== b.ref) return sameDesc ? { code: "reference-differs", strong: false } : null;
    if (!sameDesc) return { code: "reference-description-differs", strong: false };
    return a.refReliable && b.refReliable
      ? { code: "reference", strong: true }
      : { code: "reference-not-reliable", strong: false };
  }
  return sameDesc ? { code: "values-only", strong: false } : null;
}

function sameFileLink(a: Row, b: Row): Link {
  if (a.desc !== b.desc) return null;
  if (a.trueId && b.trueId) {
    return a.trueId === b.trueId ? { code: "same-file-same-id", strong: false } : null;
  }
  if (a.balance && b.balance) {
    return a.balance === b.balance ? { code: "same-file-same-balance", strong: false } : null;
  }
  if (a.ref && b.ref) {
    return a.ref === b.ref ? { code: "same-file-same-reference", strong: false } : null;
  }
  return { code: "same-file-values-only", strong: false };
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    // Lower index becomes the root, so the root is always the earliest row.
    if (ra < rb) this.parent[rb] = ra;
    else if (rb < ra) this.parent[ra] = rb;
  }
}

/** Above this many same-date same-amount rows, only same-description rows
 *  are compared with each other (keeps pathological files fast). */
const PAIRWISE_LIMIT = 400;

const quote = (s: string) => `"${s}"`;
const fileName = (f: string) => (f ? quote(f) : "this file");

function describe(code: EvidenceCode, sample: Row, files: string[]): string {
  const where =
    files.length > 1 ? `in ${files.map(fileName).join(" and ")}` : `in ${fileName(files[0] ?? "")}`;
  switch (code) {
    case "transaction-id":
      return `Same date and amount, and the same transaction ID (${sample.trueId}) ${where}. A transaction ID identifies one transaction, so these are the same row exported more than once.`;
    case "running-balance":
      return `Same date, amount and description, and the same running balance ${where}. Two separate transactions would leave different balances, so these are the same row exported more than once.`;
    case "reference":
      return `Same date, amount and description, and the same reference number (${sample.ref}) ${where}.`;
    case "transaction-id-account-unconfirmed":
      return `Same date, amount and transaction ID (${sample.trueId}) ${where}, but the descriptions differ and only one of the files names an account, so Reconly can't confirm both rows belong to the same account — nothing was set aside.`;
    case "reference-not-reliable":
      return `Same date, amount, description and reference (${sample.ref}) ${where}. That reference isn't distinctive enough to prove these are one transaction (it may be a row counter or a repeated label), so nothing was set aside.`;
    case "balance-description-differs":
      return `Same date, amount and running balance ${where}, but the descriptions differ — check whether this is one transaction described two ways.`;
    case "reference-description-differs":
      return `Same date, amount and reference number (${sample.ref}) ${where}, but the descriptions differ — check whether this is one transaction described two ways.`;
    case "reference-differs":
      return `Same date, amount and description ${where}, but different reference numbers. Reference numbers can change between exports, so this may be one transaction or two — nothing was set aside.`;
    case "values-only":
      return `Same date, amount and description ${where}. The files don't both carry a transaction ID, reference or running balance that could tell a repeated row from two separate transactions, so nothing was set aside.`;
    case "same-file-same-id":
      return `The same transaction ID (${sample.trueId}) appears more than once ${where}, with the same date, amount and description.`;
    case "same-file-same-balance":
      return `Rows with the same date, amount, description and running balance appear more than once ${where}.`;
    case "same-file-same-reference":
      return `The same reference number (${sample.ref}) appears more than once ${where}, with the same date, amount and description.`;
    case "same-file-values-only":
      return `The same date, amount and description appear more than once ${where}. The file has nothing that tells these rows apart — they may be a repeated row or separate transactions (two identical purchases on one day are normal).`;
  }
}

/**
 * Find groups of rows on ONE side that may be the same source row imported
 * more than once. Pass every imported row for that side (including rows
 * currently set aside) in import order.
 */
export function detectDuplicates(side: DuplicateSide, txns: Txn[]): DuplicateGroup[] {
  const rows = toRows(txns);
  const all = new UnionFind(rows.length);
  const strong = new UnionFind(rows.length);
  const linkCodes = new Map<number, Map<EvidenceCode, Row>>(); // keyed by lower row index

  const note = (a: Row, b: Row, link: NonNullable<Link>) => {
    all.union(a.index, b.index);
    if (link.strong) strong.union(a.index, b.index);
    const key = Math.min(a.index, b.index);
    const m = linkCodes.get(key) ?? new Map<EvidenceCode, Row>();
    if (!m.has(link.code)) m.set(link.code, a);
    linkCodes.set(key, m);
  };

  const compare = (bucket: Row[]) => {
    // Pass 1 — strong cross-file links. Remember, per row, which other
    // files already hold its proven copy.
    const provenIn = new Map<number, Set<string>>();
    const weak: [Row, Row, NonNullable<Link>][] = [];
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const link = a.file === b.file ? sameFileLink(a, b) : crossFileLink(a, b);
        if (!link) continue;
        if (link.strong) {
          note(a, b, link);
          (provenIn.get(a.index) ?? provenIn.set(a.index, new Set()).get(a.index)!).add(b.file);
          (provenIn.get(b.index) ?? provenIn.set(b.index, new Set()).get(b.index)!).add(a.file);
        } else {
          weak.push([a, b, link]);
        }
      }
    }
    // Pass 2 — possible links, skipping pairs already explained: if a row's
    // copy in the other file is proven, it is not ALSO a possible duplicate
    // of a different row in that file.
    for (const [a, b, link] of weak) {
      if (a.file !== b.file && (provenIn.get(a.index)?.has(b.file) || provenIn.get(b.index)?.has(a.file))) {
        continue;
      }
      note(a, b, link);
    }
  };

  // Only rows with the same date AND the same amount are ever compared.
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.txn.date}\u0000${r.txn.amount}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (bucket.length <= PAIRWISE_LIMIT) {
      compare(bucket);
    } else {
      const byDesc = new Map<string, Row[]>();
      for (const r of bucket) {
        const list = byDesc.get(r.desc);
        if (list) list.push(r);
        else byDesc.set(r.desc, [r]);
      }
      for (const sub of byDesc.values()) if (sub.length > 1) compare(sub);
    }
  }

  // Gather components.
  const components = new Map<number, Row[]>();
  for (const r of rows) {
    const root = all.find(r.index);
    const list = components.get(root);
    if (list) list.push(r);
    else components.set(root, [r]);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of components.values()) {
    if (members.length < 2) continue;
    const files = [...new Set(members.map((m) => m.file))];
    const kind = files.length > 1 ? "cross-file" : "within-file";

    // Strong clusters: keep the earliest row, set aside the rest — but only
    // when the cluster has at most one row per file. Two rows from the same
    // file inside a "strong" cluster means the evidence is muddled.
    const clusters = new Map<number, Row[]>();
    for (const m of members) {
      const root = strong.find(m.index);
      const list = clusters.get(root);
      if (list) list.push(m);
      else clusters.set(root, [m]);
    }
    const auto: string[] = [];
    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue;
      const clusterFiles = new Set(cluster.map((c) => c.file));
      if (clusterFiles.size !== cluster.length) continue;
      for (const c of cluster.slice(1)) auto.push(c.txn.id);
    }

    // Suggestion for the user: keep the copies from the first file.
    let suggested: string[] = [];
    if (kind === "within-file") {
      suggested = members.slice(1).map((m) => m.txn.id);
    } else {
      const perFile = new Map<string, Row[]>();
      for (const m of members) {
        const list = perFile.get(m.file);
        if (list) list.push(m);
        else perFile.set(m.file, [m]);
      }
      const counts = [...perFile.values()].map((l) => l.length);
      if (counts.every((c) => c === counts[0])) {
        const keepFile = members[0].file;
        suggested = members.filter((m) => m.file !== keepFile).map((m) => m.txn.id);
      }
    }
    for (const id of auto) if (!suggested.includes(id)) suggested.push(id);

    const codes = new Map<EvidenceCode, Row>();
    for (const m of members) {
      for (const [code, sample] of linkCodes.get(m.index) ?? []) {
        if (!codes.has(code)) codes.set(code, sample);
      }
    }
    const evidence: DuplicateEvidence[] = [...codes.entries()].map(([code, sample]) => {
      const isStrong = code === "transaction-id" || code === "running-balance" || code === "reference";
      const scope = code.startsWith("same-file") ? [sample.file] : files;
      return { code, strong: isStrong, text: describe(code, sample, scope) };
    });
    evidence.sort((a, b) => Number(b.strong) - Number(a.strong));

    groups.push({
      id: `dup:${side}:${members[0].txn.id}`,
      side,
      kind,
      txnIds: members.map((m) => m.txn.id),
      autoSetAsideIds: auto,
      suggestedSetAsideIds: suggested,
      evidence,
      files,
    });
  }
  return groups;
}

// ---- File overlap (reported separately from duplicates) --------------

export type FileOverlap = {
  side: DuplicateSide;
  fileA: string;
  fileB: string;
  /** Overlapping date range, inclusive, ISO yyyy-mm-dd. */
  start: string;
  end: string;
  /** Rows each file has inside the overlapping dates. */
  rowsA: number;
  rowsB: number;
};

/**
 * Date ranges covered by more than one file on a side. Overlap by itself
 * says nothing about duplicates — two files can cover the same dates with
 * entirely different transactions — so this is reported on its own.
 */
export function fileOverlaps(side: DuplicateSide, txns: Txn[]): FileOverlap[] {
  const cover = new Map<string, { start: string; end: string }>();
  for (const t of txns) {
    if (!t.sourceFile) continue;
    const c = cover.get(t.sourceFile);
    if (!c) cover.set(t.sourceFile, { start: t.date, end: t.date });
    else {
      if (t.date < c.start) c.start = t.date;
      if (t.date > c.end) c.end = t.date;
    }
  }
  const files = [...cover.keys()];
  const out: FileOverlap[] = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = cover.get(files[i])!;
      const b = cover.get(files[j])!;
      const start = a.start > b.start ? a.start : b.start;
      const end = a.end < b.end ? a.end : b.end;
      if (start > end) continue;
      const within = (f: string) =>
        txns.filter((t) => t.sourceFile === f && t.date >= start && t.date <= end).length;
      out.push({ side, fileA: files[i], fileB: files[j], start, end, rowsA: within(files[i]), rowsB: within(files[j]) });
    }
  }
  return out;
}

// ---- Set-aside state (the user's and the app's decisions) ------------

export type SetAsideBy = "auto" | "user";

export type DuplicateState = {
  /** Rows currently set aside (kept in the import, not in the reconciliation). */
  setAside: { txnId: string; by: SetAsideBy }[];
  /** Groups the user confirmed are separate transactions ("keep all"). */
  dismissedGroupIds: string[];
  /** When each of those confirmations was made (ISO). Optional: absent for
   *  confirmations recorded before timestamps were kept. */
  dismissedAt?: Record<string, string>;
  /** Audit trail of every set-aside / restore, oldest first. */
  history: { txnId: string; action: "set-aside" | "restore"; by: SetAsideBy; at: string }[];
};

export const EMPTY_DUPLICATE_STATE: DuplicateState = {
  setAside: [],
  dismissedGroupIds: [],
  history: [],
};

/** State right after import: strong-evidence copies are set aside. */
export function initialDuplicateState(groups: DuplicateGroup[], at: string): DuplicateState {
  const ids = groups.flatMap((g) => g.autoSetAsideIds);
  return {
    setAside: ids.map((txnId) => ({ txnId, by: "auto" as const })),
    dismissedGroupIds: [],
    history: ids.map((txnId) => ({ txnId, action: "set-aside" as const, by: "auto" as const, at })),
  };
}

export function setAsideRows(
  state: DuplicateState,
  txnIds: string[],
  by: SetAsideBy,
  at: string
): DuplicateState {
  const already = new Set(state.setAside.map((s) => s.txnId));
  const fresh = [...new Set(txnIds)].filter((id) => !already.has(id));
  if (fresh.length === 0) return state;
  return {
    ...state,
    setAside: [...state.setAside, ...fresh.map((txnId) => ({ txnId, by }))],
    history: [...state.history, ...fresh.map((txnId) => ({ txnId, action: "set-aside" as const, by, at }))],
  };
}

export function restoreRows(state: DuplicateState, txnIds: string[], at: string): DuplicateState {
  const target = new Set(txnIds);
  const hit = state.setAside.filter((s) => target.has(s.txnId));
  if (hit.length === 0) return state;
  return {
    ...state,
    setAside: state.setAside.filter((s) => !target.has(s.txnId)),
    history: [
      ...state.history,
      ...hit.map((s) => ({ txnId: s.txnId, action: "restore" as const, by: "user" as const, at })),
    ],
  };
}

export function dismissGroup(
  state: DuplicateState,
  groupId: string,
  dismissed: boolean,
  at?: string
): DuplicateState {
  const has = state.dismissedGroupIds.includes(groupId);
  if (dismissed === has) return state;
  const dismissedAt = { ...(state.dismissedAt ?? {}) };
  if (dismissed && at) dismissedAt[groupId] = at;
  if (!dismissed) delete dismissedAt[groupId];
  return {
    ...state,
    dismissedGroupIds: dismissed
      ? [...state.dismissedGroupIds, groupId]
      : state.dismissedGroupIds.filter((id) => id !== groupId),
    dismissedAt,
  };
}

/** How many duplicate groups still need the user's decision. */
export function unresolvedGroupCount(groups: DuplicateGroup[], state: DuplicateState): number {
  return groups.filter((g) => groupStatus(g, state) === "needs-review").length;
}

/** The rows the reconciliation actually uses: everything not set aside. */
export function activeTxns(txns: Txn[], state: DuplicateState): Txn[] {
  if (state.setAside.length === 0) return txns;
  const out = new Set(state.setAside.map((s) => s.txnId));
  return txns.filter((t) => !out.has(t.id));
}

export type GroupStatus =
  /** Two or more of its rows are still in use and the user hasn't decided. */
  | "needs-review"
  /** The user confirmed these are separate transactions. */
  | "kept-all"
  /** At most one row is still in use. */
  | "resolved";

export function groupStatus(group: DuplicateGroup, state: DuplicateState): GroupStatus {
  const out = new Set(state.setAside.map((s) => s.txnId));
  const inUse = group.txnIds.filter((id) => !out.has(id)).length;
  if (inUse <= 1) return "resolved";
  return state.dismissedGroupIds.includes(group.id) ? "kept-all" : "needs-review";
}

/** Drop decisions that refer to rows no longer in the import. */
export function sanitizeDuplicateState(
  state: DuplicateState | undefined,
  knownTxnIds: ReadonlySet<string>
): DuplicateState {
  if (!state) return EMPTY_DUPLICATE_STATE;
  return {
    setAside: (state.setAside ?? []).filter((s) => knownTxnIds.has(s.txnId)),
    dismissedGroupIds: state.dismissedGroupIds ?? [],
    history: state.history ?? [],
    ...(state.dismissedAt ? { dismissedAt: state.dismissedAt } : {}),
  };
}

export type ImportCounts = { imported: number; inUse: number; setAside: number };

export function importCounts(txns: Txn[], state: DuplicateState): ImportCounts {
  const ids = new Set(txns.map((t) => t.id));
  const setAside = state.setAside.filter((s) => ids.has(s.txnId)).length;
  return { imported: txns.length, inUse: txns.length - setAside, setAside };
}
