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

function isSourceTsFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.d.ts')
  );
}

export function findCoverageReport(rootDir: string): string | null {
  const coverageDir = path.join(rootDir, 'coverage');
  if (!fs.existsSync(coverageDir)) return null;

  const stack = [coverageDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile() && entry.name === 'coverage-final.json')
        return abs;
    }
  }
  return null;
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

    if (reportPath) {
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
        )}.`,
      });
    }

    const coverageNote =
      avgCoveragePct !== null
        ? `avg line coverage ${avgCoveragePct.toFixed(1)}%`
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
