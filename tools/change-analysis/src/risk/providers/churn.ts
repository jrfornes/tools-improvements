import simpleGit from 'simple-git';
import { SHALLOW_CLONE_REASON } from '../../core/git-env';
import type { PlanInput, ProviderOutput, RiskProvider } from '../types';

const ID = 'churn';
const LABEL = 'Code churn (90d)';

/**
 * Context only. Reports the *hottest* file rather than the mean: averaging
 * churn across a large diff hides the one file that actually moves constantly.
 */
export const churnProvider: RiskProvider = {
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

    const git = simpleGit(process.cwd());
    const counts: Array<{ file: string; commits: number }> = [];

    for (const file of input.changedFiles) {
      try {
        const log = await git.log({
          file,
          '--since': '90 days ago',
        } as Parameters<typeof git.log>[0]);
        counts.push({ file, commits: log.total });
      } catch {
        // New file or no history — contributes nothing.
      }
    }

    if (counts.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'ok',
        summary: 'No 90-day history for the changed files',
        findings: [],
      };
    }

    const sorted = [...counts].sort((a, b) => b.commits - a.commits);
    const hottest = sorted[0];
    const total = counts.reduce((acc, c) => acc + c.commits, 0);

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `${total} commit(s) in 90d across changed files; hottest ${hottest.file} (${hottest.commits})`,
      findings: [],
      details: {
        maxCommits90d: hottest.commits,
        hottestFile: hottest.file,
        topFiles: sorted.slice(0, 5),
      },
    };
  },
};
