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

export interface CommitFiles {
  hash: string;
  files: string[];
}

/**
 * Precedes each commit hash in the `git log` format string below. A control
 * character can't appear in a file path, so a commit-hash line can never be
 * confused with a file-path line.
 */
const RECORD_SEP = '';

/**
 * Parses the output of
 * `git log -n<N> --format=<RECORD_SEP>%H --name-only --full-diff -- <file>`
 * into one record per commit.
 *
 * `--full-diff` matters: without it, `--name-only` combined with a trailing
 * pathspec lists only `<file>` itself for every matching commit, instead of
 * every file that commit actually touched — which is the whole point of a
 * co-change query. This one call replaces what used to be a `git log` (to
 * list commit hashes) plus one `git show` per commit, cutting up to ~30
 * sequential git subprocess spawns per changed file down to 1.
 *
 * Note: `git log` (unlike `git show`) prints no diff for a merge commit
 * unless `-m`/`--first-parent` is passed, so a merge commit in a file's
 * history contributes an empty file list here rather than the merge's
 * combined diff.
 */
export function parseCommitFileLists(raw: string): CommitFiles[] {
  const records: CommitFiles[] = [];
  let current: CommitFiles | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(RECORD_SEP)) {
      current = { hash: line.slice(RECORD_SEP.length), files: [] };
      records.push(current);
    } else if (current) {
      current.files.push(line);
    }
  }

  return records;
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
      let commits: CommitFiles[] = [];
      try {
        const raw = await git.raw([
          'log',
          `-n${MAX_COMMITS_PER_FILE}`,
          `--format=${RECORD_SEP}%H`,
          '--name-only',
          '--full-diff',
          '--',
          sourceFile,
        ]);
        commits = parseCommitFileLists(raw);
      } catch {
        continue;
      }
      if (commits.length === 0) continue;

      const coChangeCount = new Map<string, number>();
      for (const commit of commits) {
        for (const file of commit.files) {
          if (file === sourceFile) continue;
          coChangeCount.set(file, (coChangeCount.get(file) ?? 0) + 1);
        }
      }

      for (const [coupledFile, count] of coChangeCount) {
        const rate = count / commits.length;
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
            sourceCommitCount: commits.length,
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
