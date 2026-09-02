import simpleGit from 'simple-git';
import { SHALLOW_CLONE_REASON } from '../../core/git-env';
import { isIgnoredPath } from '../../diff/get-changed-files';
import type {
  Finding,
  PlanInput,
  ProviderOutput,
  RiskProvider,
} from '../types';

const ID = 'logicalCoupling';
const LABEL = 'Logical coupling';

const MAX_FILES_TO_ANALYZE = 20;
const MAX_COMMITS_PER_FILE = 30;
const MIN_COCHANGE_COUNT = 3;
const MIN_COUPLING_RATE = 0.8;
const MAX_FINDINGS = 5;

interface CouplingCandidate {
  sourceFile: string;
  coupledFile: string;
  coChangeCount: number;
  sourceCommitCount: number;
  rate: number;
}

function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const logicalCouplingProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    if (input.shallowRepo) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason: SHALLOW_CLONE_REASON,
        summary: 'Not evaluated',
        findings: [],
      };
    }

    if (input.changedFiles.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'not-applicable',
        reason: 'No changed files',
        summary: 'No changed files',
        findings: [],
      };
    }

    const changedSet = new Set(input.changedFiles);
    const filesToAnalyze = input.changedFiles.slice(0, MAX_FILES_TO_ANALYZE);
    const truncated = input.changedFiles.length - filesToAnalyze.length;
    const git = simpleGit(process.cwd());
    const missingCouples: CouplingCandidate[] = [];

    for (const sourceFile of filesToAnalyze) {
      let hashes: string[] = [];
      try {
        hashes = parseLines(
          await git.raw([
            'log',
            `-n${MAX_COMMITS_PER_FILE}`,
            '--format=%H',
            '--',
            sourceFile,
          ])
        );
      } catch {
        continue;
      }
      if (hashes.length === 0) continue;

      const coChangeCount = new Map<string, number>();
      for (const hash of hashes) {
        try {
          const filesInCommit = new Set(
            parseLines(
              await git.raw(['show', '--pretty=format:', '--name-only', hash])
            )
          );
          filesInCommit.delete(sourceFile);
          for (const file of filesInCommit) {
            coChangeCount.set(file, (coChangeCount.get(file) ?? 0) + 1);
          }
        } catch {
          continue;
        }
      }

      for (const [coupledFile, count] of coChangeCount) {
        const rate = count / hashes.length;
        if (
          count >= MIN_COCHANGE_COUNT &&
          rate >= MIN_COUPLING_RATE &&
          !changedSet.has(coupledFile) &&
          // Lockfiles are stripped from the diff by getChangedFiles, so they
          // would otherwise always look "omitted" when they were simply hidden.
          !isIgnoredPath(coupledFile)
        ) {
          missingCouples.push({
            sourceFile,
            coupledFile,
            coChangeCount: count,
            sourceCommitCount: hashes.length,
            rate,
          });
        }
      }
    }

    const topMissing = missingCouples
      .sort((a, b) =>
        b.rate !== a.rate ? b.rate - a.rate : b.coChangeCount - a.coChangeCount
      )
      .slice(0, MAX_FINDINGS);

    const findings: Finding[] = topMissing.map((item) => ({
      providerId: ID,
      kind: 'omitted-coupled-file',
      severity: 'high',
      title: `${item.coupledFile} usually changes with ${item.sourceFile}, but is not in this diff`,
      evidence: `Changed together in ${item.coChangeCount} of the last ${
        item.sourceCommitCount
      } commit(s) touching ${item.sourceFile} (${(item.rate * 100).toFixed(
        0
      )}%). Confirm the omission is intentional.`,
      files: [item.sourceFile, item.coupledFile],
    }));

    const truncatedNote =
      truncated > 0 ? `; ${truncated} file(s) not analysed` : '';

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `${topMissing.length} likely co-changed file(s) missing from the diff${truncatedNote}`,
      findings,
      details: {
        analysedFiles: filesToAnalyze.length,
        skippedFiles: truncated,
        candidates: topMissing,
      },
    };
  },
};
