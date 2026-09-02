import simpleGit from 'simple-git';
import {
  applyJiraClassification,
  classifyIssueKeys,
  DEFAULT_BUG_TYPES,
  jiraConfigFromEnv,
  type JiraConfig,
} from './jira-classifier';

export interface CommitDetail {
  hash: string;
  date: string;
  author: string;
  message: string;
  tags: string[];
}

export interface BugRecord {
  key: string;
  commits: number;
  files: string[];
  lastSeen: string;
  commitDetails: CommitDetail[];
  /** Jira issue type, present only when the index was classified. */
  issueType?: string;
}

export interface BugIndex {
  generatedAt: string;
  source: 'git-history';
  sinceDays?: string;
  tag?: string;
  bugPattern: string;
  /**
   * True only when issue keys were resolved against Jira and filtered to real
   * defect types. Consumers must not present an unclassified index as defect
   * history — it contains every referenced ticket, features included.
   */
  classified: boolean;
  classification?: {
    bugTypes: string[];
    resolvedKeys: number;
    unresolvedKeys: number;
    droppedNonBugs: number;
    failures: string[];
  };
  totalBugs: number;
  totalCommits: number;
  bugs: BugRecord[];
  byFile: Record<string, string[]>;
}

export interface BuildBugIndexOptions {
  since?: string;
  bugPattern?: string;
  tag?: string;
  tagPattern?: string;
  repoRoot?: string;
  /** Resolve issue types via Jira and keep only real defects. */
  jira?: boolean;
  bugTypes?: string[];
  jiraConfig?: JiraConfig | null;
}

export async function buildBugIndex(
  opts: BuildBugIndexOptions = {}
): Promise<BugIndex> {
  const {
    since = '365 days ago',
    bugPattern = '[A-Z]+-\\d+',
    tag,
    tagPattern,
    repoRoot = process.cwd(),
    jira = false,
    bugTypes = DEFAULT_BUG_TYPES,
    jiraConfig,
  } = opts;

  const git = simpleGit(repoRoot);
  const regex = new RegExp(bugPattern, 'g');

  const rawLog = await git.raw([
    'log',
    tag ? tag : `--since=${since}`,
    '--format=%H|%aI|%an|%s',
  ]);

  const lines = rawLog.split('\n').filter(Boolean);

  const tagCacheRaw = await git
    .raw(['tag', '--format=%(refname:short)|%(objectname:short)'])
    .catch(() => '');
  const tagShortToRef = new Map<string, string>();
  for (const line of tagCacheRaw.split('\n').filter(Boolean)) {
    const [tagName, shortHash] = line.split('|');
    if (tagName && shortHash) tagShortToRef.set(shortHash, tagName);
  }

  let filteredTags: Set<string> | null = null;
  if (tagPattern) {
    const tagListRaw = await git.raw(['tag', '-l', tagPattern]).catch(() => '');
    filteredTags = new Set(tagListRaw.split('\n').filter(Boolean));
  }

  const bugMap = new Map<
    string,
    {
      commits: number;
      files: Set<string>;
      lastSeen: string;
      commitDetails: CommitDetail[];
    }
  >();

  let totalCommits = 0;

  for (const line of lines) {
    const [hash, date, author, ...messageParts] = line.split('|');
    const message = messageParts.join('|');
    if (!hash || !message) continue;

    const matched = message.match(regex);
    if (!matched) continue;

    const bugIds = [...new Set(matched.map((m) => m.toUpperCase()))];

    let commitFiles: string[] = [];
    try {
      const diffRaw = await git.raw([
        'diff-tree',
        '--no-commit-id',
        '-r',
        '--name-only',
        hash,
      ]);
      commitFiles = diffRaw.split('\n').filter(Boolean);
    } catch {
      commitFiles = [];
    }

    let commitTags: string[] = [];
    try {
      const tagsRaw = await git.raw(['tag', '--contains', hash]);
      commitTags = tagsRaw.split('\n').filter(Boolean);
      if (filteredTags) {
        commitTags = commitTags.filter((t) => filteredTags!.has(t));
      }
    } catch {
      commitTags = [];
    }

    const detail: CommitDetail = {
      hash: hash.slice(0, 7),
      date,
      author,
      message,
      tags: commitTags,
    };

    totalCommits++;

    for (const bugId of bugIds) {
      if (!bugMap.has(bugId)) {
        bugMap.set(bugId, {
          commits: 0,
          files: new Set(),
          lastSeen: date,
          commitDetails: [],
        });
      }
      const rec = bugMap.get(bugId)!;
      rec.commits++;
      for (const f of commitFiles) rec.files.add(f);
      if (date > rec.lastSeen) rec.lastSeen = date;
      rec.commitDetails.push(detail);
    }
  }

  // Resolve issue types before building records. Only filter to defects when
  // every Jira batch succeeded — a partial failure must leave the index
  // unclassified so consumers abstain instead of reporting "no defects".
  let issueTypes = new Map<string, string>();
  let classified = false;
  let classification: BugIndex['classification'];

  if (jira) {
    const config = jiraConfig ?? jiraConfigFromEnv();
    if (!config) {
      throw new Error(
        'Jira classification requested but JIRA_EMAIL / JIRA_API_TOKEN are not set.'
      );
    }
    const allKeys = [...bugMap.keys()];
    const result = await classifyIssueKeys(allKeys, config);
    issueTypes = result.types;

    const applied = applyJiraClassification(
      allKeys,
      result.types,
      result.unresolvedKeys,
      result.failures,
      bugTypes
    );
    classified = applied.classified;

    if (classified) {
      const keep = new Set(applied.keptKeys);
      for (const key of allKeys) {
        if (!keep.has(key)) bugMap.delete(key);
      }
    }

    classification = {
      bugTypes,
      resolvedKeys: result.types.size,
      unresolvedKeys: result.unresolvedKeys.length,
      droppedNonBugs: applied.droppedNonBugs,
      failures: result.failures,
    };
  }

  const bugs: BugRecord[] = [];
  const byFile: Record<string, string[]> = {};

  for (const [key, rec] of bugMap.entries()) {
    const filesArr = [...rec.files];
    bugs.push({
      key,
      commits: rec.commits,
      files: filesArr,
      lastSeen: rec.lastSeen,
      // Sort before capping — capping first kept whichever 10 happened to be
      // encountered rather than the 10 most recent.
      commitDetails: [...rec.commitDetails]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10),
      issueType: issueTypes.get(key),
    });
    for (const f of filesArr) {
      if (!byFile[f]) byFile[f] = [];
      if (!byFile[f].includes(key)) byFile[f].push(key);
    }
  }

  bugs.sort((a, b) => b.commits - a.commits);

  return {
    generatedAt: new Date().toISOString(),
    source: 'git-history',
    sinceDays: tag ? undefined : since,
    tag: tag ?? undefined,
    bugPattern,
    classified,
    classification,
    totalBugs: bugs.length,
    totalCommits,
    bugs,
    byFile,
  };
}
