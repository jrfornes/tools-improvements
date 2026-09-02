import * as fs from 'fs';
import * as path from 'path';
import type {
  Finding,
  PlanInput,
  ProviderOutput,
  RiskProvider,
} from '../types';

const ID = 'bugHistory';
const LABEL = 'Bug history';

/** A defect touched within this window is treated as a live risk area. */
const RECENT_DEFECT_DAYS = 30;
const MAX_FINDINGS = 3;

interface BugRecord {
  key: string;
  commits: number;
  files: string[];
  lastSeen: string;
  issueType?: string;
}

interface BugIndex {
  sinceDays?: string;
  tag?: string;
  /**
   * True only when issue keys were resolved against Jira and filtered to real
   * defect types. An unclassified index contains every referenced ticket,
   * features included, and cannot support a defect finding.
   */
  classified?: boolean;
  bugs: BugRecord[];
  byFile: Record<string, string[]>;
}

export const BUG_INDEX_PATH = path.join('tools', '.data', 'bugs-index.json');

function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, (nowMs - new Date(iso).getTime()) / 86_400_000);
}

export const bugHistoryProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    const indexPath = path.join(process.cwd(), BUG_INDEX_PATH);

    if (!fs.existsSync(indexPath)) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason: 'No bugs index — run: nx run bugs-index:build --jira',
        summary: 'Not evaluated',
        findings: [],
      };
    }

    let index: BugIndex;
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as BugIndex;
    } catch (err) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason: `Bugs index is unreadable: ${
          err instanceof Error ? err.message : String(err)
        }`,
        summary: 'Not evaluated',
        findings: [],
      };
    }

    const matchedKeys = new Set<string>();
    const keyToFiles = new Map<string, string[]>();
    for (const file of input.changedFiles) {
      for (const key of index.byFile[file] ?? []) {
        matchedKeys.add(key);
        keyToFiles.set(key, [...(keyToFiles.get(key) ?? []), file]);
      }
    }

    // Reporting "3 prior tickets touched these files" is still useful context,
    // but an unclassified index cannot distinguish a defect from a feature, so
    // it must not produce a recommendation.
    if (index.classified !== true) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason:
          'Bugs index is unclassified — every Jira key is indexed, including features. ' +
          'Rebuild with: nx run bugs-index:build --jira',
        summary: `${matchedKeys.size} prior ticket(s) touched the changed files (unclassified)`,
        findings: [],
      };
    }

    const nowMs = Date.now();
    const matched = [...matchedKeys]
      .map((key) => index.bugs.find((b) => b.key === key))
      .filter((b): b is BugRecord => b !== undefined)
      .map((bug) => ({ bug, age: daysSince(bug.lastSeen, nowMs) }))
      .sort((a, b) => a.age - b.age);

    const findings: Finding[] = matched
      .slice(0, MAX_FINDINGS)
      .map(({ bug, age }) => ({
        providerId: ID,
        kind: 'recent-defect-area',
        severity:
          age <= RECENT_DEFECT_DAYS ? ('high' as const) : ('medium' as const),
        title: `Changed code previously caused defect ${bug.key}`,
        evidence: `${bug.key} (${
          bug.issueType ?? 'Bug'
        }) last touched these files ${Math.round(age)} day(s) ago across ${
          bug.commits
        } commit(s).`,
        files: keyToFiles.get(bug.key),
      }));

    const summary =
      matched.length === 0
        ? 'No prior defects recorded against the changed files'
        : `${
            matched.length
          } prior defect(s) touched the changed files; most recent ${Math.round(
            matched[0].age
          )} day(s) ago`;

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary,
      findings,
      details: {
        defectCount: matched.length,
        window: index.tag ?? index.sinceDays,
      },
    };
  },
};
