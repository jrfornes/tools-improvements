import * as fs from 'fs';
import * as path from 'path';
import type {
  Finding,
  PlanInput,
  ProviderOutput,
  RiskProvider,
} from '../types';

const ID = 'testCoverage';
const LABEL = 'Test coverage';

const COVERAGE_TARGET_PCT = 80;
const MAX_FINDINGS = 5;

interface CoverageFileData {
  lines?: { pct?: number };
}
type CoverageJson = Record<string, CoverageFileData>;

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

export function isSourceTsFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.cy.ts') &&
    !file.endsWith('.d.ts')
  );
}

/**
 * A stale report from an earlier run (a different branch, a project nobody
 * touched today) reads as measured-and-fine even though it says nothing
 * about the current diff. Picking the most recently written report, and
 * surfacing its age, at least makes the risk visible instead of silent.
 */
export function findCoverageReport(rootDir: string): string | null {
  const coverageDir = path.join(rootDir, 'coverage');
  if (!fs.existsSync(coverageDir)) return null;

  let newest: { path: string; mtimeMs: number } | null = null;
  const stack = [coverageDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name === 'coverage-final.json') {
        const mtimeMs = fs.statSync(abs).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { path: abs, mtimeMs };
      }
    }
  }
  return newest?.path ?? null;
}

/** e.g. "42m", "3h", "5d" — coarse on purpose, this is a staleness cue, not a clock. */
export function formatAge(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function getCoveragePct(
  coverage: CoverageJson,
  relativeFile: string
): number | undefined {
  const rel = normalizePath(relativeFile);
  for (const [fullPath, data] of Object.entries(coverage)) {
    if (normalizePath(fullPath).endsWith(rel)) return data.lines?.pct;
  }
  return undefined;
}

export const testCoverageProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    const targetFiles = input.changedFiles.filter(isSourceTsFile);

    if (targetFiles.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'not-applicable',
        reason: 'No changed TypeScript source files',
        summary: 'No TypeScript source files in this change',
        findings: [],
      };
    }

    const missingSpecFiles = targetFiles.filter(
      (file) =>
        !fs.existsSync(
          path.join(process.cwd(), file.replace(/\.ts$/, '.spec.ts'))
        )
    );

    const findings: Finding[] = missingSpecFiles
      .slice(0, MAX_FINDINGS)
      .map((file) => ({
        providerId: ID,
        kind: 'missing-spec',
        severity: 'high' as const,
        title: `No unit tests for ${file}`,
        evidence: `Expected an adjacent spec at ${file.replace(
          /\.ts$/,
          '.spec.ts'
        )}, which does not exist.`,
        files: [file],
      }));

    // Coverage numbers are only available if a test run has already produced
    // them in this workspace. Say so rather than reporting 0% as if measured.
    const reportPath = findCoverageReport(process.cwd());
    let avgCoveragePct: number | null = null;
    let reportAgeMs: number | null = null;

    if (reportPath) {
      reportAgeMs = Date.now() - fs.statSync(reportPath).mtimeMs;
      try {
        const parsed = JSON.parse(
          fs.readFileSync(reportPath, 'utf-8')
        ) as CoverageJson;
        const pcts = targetFiles
          .map((file) => getCoveragePct(parsed, file))
          .filter((pct): pct is number => typeof pct === 'number');
        if (pcts.length > 0) {
          avgCoveragePct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
        }
      } catch {
        avgCoveragePct = null;
      }
    }

    // A report older than the run is worth flagging even when the number
    // looks fine — it may simply predate this diff.
    const STALE_AGE_MS = 60 * 60_000;
    const ageNote =
      reportAgeMs !== null
        ? ` (report ${formatAge(reportAgeMs)} old${
            reportAgeMs > STALE_AGE_MS ? ', may be stale — rerun tests' : ''
          })`
        : '';

    if (avgCoveragePct !== null && avgCoveragePct < COVERAGE_TARGET_PCT) {
      findings.push({
        providerId: ID,
        kind: 'low-coverage',
        severity: 'medium',
        title: `Changed files average ${avgCoveragePct.toFixed(
          1
        )}% line coverage`,
        evidence: `Below the ${COVERAGE_TARGET_PCT}% target, measured from ${path.relative(
          process.cwd(),
          reportPath as string
        )}${ageNote}.`,
      });
    }

    const coverageNote =
      avgCoveragePct !== null
        ? `avg line coverage ${avgCoveragePct.toFixed(1)}%${ageNote}`
        : 'no coverage report in workspace (run tests first)';

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `${missingSpecFiles.length}/${targetFiles.length} changed file(s) without an adjacent spec, ${coverageNote}`,
      findings,
      details: {
        missingSpecCount: missingSpecFiles.length,
        avgCoveragePct,
        coverageReportPath: reportPath ?? undefined,
      },
    };
  },
};
