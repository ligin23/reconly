// Test helper: runs the advanced demo files through the same pipeline
// app-shell's confirmMapping uses (parser → combine → duplicates → engine →
// statement checks → month review). Reads the real files from public/.
import { readFileSync } from "fs";
import { resolve } from "path";
import { combineFiles } from "@/lib/import/combine";
import { activeTxns, detectDuplicates, initialDuplicateState } from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon";
import { verifyStatements } from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import type { SourceFileInfo } from "@/lib/data/repository";
import { ADVANCED_DEMO_FILES } from "../advanced-demo";

export const DEMO_DIR = resolve(__dirname, "../../../../public/samples/advanced");

export function demoContent(name: string): string {
  return readFileSync(resolve(DEMO_DIR, name), "utf8");
}

export function runDemoPipeline() {
  const side = (s: "bank" | "ledger") =>
    combineFiles(
      s,
      ADVANCED_DEMO_FILES.filter((f) => f.side === s).map((f) => ({
        name: f.name,
        content: demoContent(f.name),
        map: f.map,
        headerRow: f.headerRow,
      }))
    );
  const bank = side("bank");
  const ledger = side("ledger");
  const imported = { bank: bank.txns, ledger: ledger.txns };
  const groups = [...detectDuplicates("bank", imported.bank), ...detectDuplicates("ledger", imported.ledger)];
  const dupState = initialDuplicateState(groups, "2026-04-01T00:00:00.000Z");
  const bankTxns = activeTxns(imported.bank, dupState);
  const ledgerTxns = activeTxns(imported.ledger, dupState);
  const result = reconcile(bankTxns, ledgerTxns);
  // Same fields app-shell's confirmMapping records per file.
  const sourceFiles: SourceFileInfo[] = [bank, ledger].flatMap((imp) =>
    imp.files.map((f) => ({
      side: f.side,
      name: f.name,
      rows: f.rowCount,
      headerRow: f.headerRow,
      periodStart: f.coverage?.start ?? null,
      periodEnd: f.coverage?.end ?? null,
      statementStart: f.diagnostics.statementPeriod?.start ?? null,
      statementEnd: f.diagnostics.statementPeriod?.end ?? null,
      skippedRows: f.diagnostics.issueCount,
      invalidDateRows: f.diagnostics.invalidDateRows,
      statementOpening: f.diagnostics.statement.opening,
      statementClosing: f.diagnostics.statement.closing,
      statementAmbiguities: f.diagnostics.statement.ambiguities,
      ...(f.diagnostics.statement.owedIndication
        ? { statementOwedIndication: f.diagnostics.statement.owedIndication }
        : {}),
    }))
  );
  const statements = verifyStatements(imported.bank, sourceFiles);
  const months = buildMonthReview({
    statementReview: statements,
    imported,
    bankTxns,
    ledgerTxns,
    matches: result.matches,
    compositeMatches: result.compositeMatches,
    addedBankIds: new Set(),
    acknowledgedLedgerIds: new Set(),
    duplicateGroups: groups,
    duplicateState: dupState,
    sourceFiles,
  });
  return { bank, ledger, imported, groups, dupState, bankTxns, ledgerTxns, result, sourceFiles, statements, months };
}
