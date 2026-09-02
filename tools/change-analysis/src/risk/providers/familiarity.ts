import simpleGit from 'simple-git';
import { SHALLOW_CLONE_REASON } from '../../core/git-env';
import type {
  Finding,
  PlanInput,
  ProviderOutput,
  RiskProvider,
} from '../types';

const ID = 'familiarity';
const LABEL = 'Author familiarity';

/** Below this share of recent commits on their most-owned file, suggest reviewers. */
const OWNERSHIP_THRESHOLD = 0.2;
const HISTORY_WINDOW = '12 months ago';
const MAX_REVIEWERS = 3;

function isRelevantFile(file: string): boolean {
  return !file.endsWith('.lock') && file !== 'package-lock.json';
}

export const familiarityProvider: RiskProvider = {
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

    const author = input.authorEmail?.trim().toLowerCase();
    if (!author) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason: 'No author email — pass --author or set git config user.email',
        summary: 'Not evaluated',
        findings: [],
      };
    }

    const files = input.changedFiles.filter(isRelevantFile);
    if (files.length === 0) {
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
    const reviewerScores = new Map<string, number>();
    // Best per-file ownership, not pooled across the diff: a pooled ratio is
    // dominated by whichever file has the most commits and sits near zero for
    // everyone on a team of any size, which discriminates nothing.
    let bestOwnership = 0;
    let bestOwnedFile: string | undefined;
    let filesWithHistory = 0;

    for (const file of files) {
      let emails: string[];
      try {
        const raw = await git.raw([
          'log',
          `--since=${HISTORY_WINDOW}`,
          '--format=%ae',
          '--',
          file,
        ]);
        emails = raw
          .split('\n')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
      } catch {
        continue;
      }
      if (emails.length === 0) continue;
      filesWithHistory++;

      const counts = new Map<string, number>();
      for (const email of emails) {
        counts.set(email, (counts.get(email) ?? 0) + 1);
      }

      const ownership = (counts.get(author) ?? 0) / emails.length;
      if (ownership > bestOwnership) {
        bestOwnership = ownership;
        bestOwnedFile = file;
      }

      for (const [email, count] of counts) {
        if (email !== author) {
          reviewerScores.set(email, (reviewerScores.get(email) ?? 0) + count);
        }
      }
    }

    if (filesWithHistory === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'ok',
        summary: `No commits in the last 12 months for the changed files — all new to ${author}`,
        findings: [],
      };
    }

    const topReviewers = [...reviewerScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_REVIEWERS)
      .map(([email]) => email);

    const findings: Finding[] =
      bestOwnership < OWNERSHIP_THRESHOLD && topReviewers.length > 0
        ? [
            {
              providerId: ID,
              kind: 'low-ownership',
              severity: 'low',
              title: `Request review from ${topReviewers.join(', ')}`,
              evidence: `${author} authored at most ${(
                bestOwnership * 100
              ).toFixed(
                0
              )}% of the last 12 months of commits on any changed file. The listed reviewers have the most history here.`,
            },
          ]
        : [];

    const ownedNote = bestOwnedFile ? ` (highest on ${bestOwnedFile})` : '';

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `${author} owns up to ${(bestOwnership * 100).toFixed(
        0
      )}% of recent commits on the changed files${ownedNote}`,
      findings,
      details: { bestOwnership, bestOwnedFile, topReviewers, filesWithHistory },
    };
  },
};
