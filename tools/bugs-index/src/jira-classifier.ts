/**
 * Resolves Jira issue types for a set of issue keys so the bugs index can hold
 * actual defects rather than every ticket ever referenced in a commit message.
 *
 * Without this step the index treats `[A-Z]+-\d+` in a commit subject as a bug,
 * so feature tickets are indistinguishable from defects and any "this file
 * previously caused a bug" claim is unsupportable.
 */

/** Jira caps `maxResults` at 100 for issue search. */
export const JIRA_BATCH_SIZE = 100;

export const DEFAULT_BUG_TYPES = ['Bug', 'Defect'];

export interface JiraConfig {
  site: string;
  email: string;
  apiToken: string;
}

export interface ClassifyResult {
  /** Issue key (uppercased) -> issue type name. */
  types: Map<string, string>;
  /** Keys in batches that could not be fetched; caller decides how to treat them. */
  unresolvedKeys: string[];
  failures: string[];
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function jiraConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): JiraConfig | null {
  const site = (env.JIRA_SITE ?? 'https://cloud-cs.atlassian.net').replace(
    /\/+$/,
    ''
  );
  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();
  if (!email || !apiToken) return null;
  return { site, email, apiToken };
}

function authHeader(config: JiraConfig): string {
  const raw = `${config.email}:${config.apiToken}`;
  return `Basic ${Buffer.from(raw, 'utf-8').toString('base64')}`;
}

interface JiraSearchResponse {
  issues?: Array<{
    key?: string;
    fields?: { issuetype?: { name?: string } };
  }>;
}

async function fetchBatch(
  keys: string[],
  config: JiraConfig
): Promise<JiraSearchResponse> {
  const jql = `key in (${keys.join(',')})`;
  const body = JSON.stringify({
    jql,
    fields: ['issuetype'],
    maxResults: JIRA_BATCH_SIZE,
  });
  const headers = {
    Authorization: authHeader(config),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // /search/jql is the current Jira Cloud endpoint; /search is the older one
  // and is still what some instances expose. Try new, fall back to legacy.
  for (const endpoint of ['/rest/api/3/search/jql', '/rest/api/3/search']) {
    const response = await fetch(`${config.site}${endpoint}`, {
      method: 'POST',
      headers,
      body,
    });
    if (response.status === 404 || response.status === 410) continue;
    if (!response.ok) {
      throw new Error(
        `Jira ${endpoint} returned ${response.status} ${response.statusText}`
      );
    }
    return (await response.json()) as JiraSearchResponse;
  }

  throw new Error(
    'No usable Jira search endpoint (both /search/jql and /search 404ed)'
  );
}

/** Retries before a batch is counted as failed — a transient blip must not
 *  tax the whole index the same way a persistently broken batch does. */
export const JIRA_BATCH_RETRIES = 2;

function backoffMs(attempt: number): number {
  return 300 * 2 ** attempt;
}

async function fetchBatchWithRetry(
  batch: string[],
  config: JiraConfig,
  fetchImpl: (
    batch: string[],
    config: JiraConfig
  ) => Promise<JiraSearchResponse>,
  retries: number,
  delay: (ms: number) => Promise<void>
): Promise<JiraSearchResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchImpl(batch, config);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await delay(backoffMs(attempt));
    }
  }
  throw lastErr;
}

export async function classifyIssueKeys(
  keys: string[],
  config: JiraConfig,
  fetchImpl: (
    batch: string[],
    config: JiraConfig
  ) => Promise<JiraSearchResponse> = fetchBatch,
  retries: number = JIRA_BATCH_RETRIES,
  delay: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<ClassifyResult> {
  const types = new Map<string, string>();
  const unresolvedKeys: string[] = [];
  const failures: string[] = [];

  for (const batch of chunk(keys, JIRA_BATCH_SIZE)) {
    try {
      const data = await fetchBatchWithRetry(
        batch,
        config,
        fetchImpl,
        retries,
        delay
      );
      for (const issue of data.issues ?? []) {
        const key = issue.key?.toUpperCase();
        const typeName = issue.fields?.issuetype?.name;
        if (key && typeName) types.set(key, typeName);
      }
      // Keys Jira did not return (deleted, moved, or no permission).
      for (const key of batch) {
        if (!types.has(key)) unresolvedKeys.push(key);
      }
    } catch (err) {
      // A failed batch must not lose the batches that did succeed.
      unresolvedKeys.push(...batch);
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { types, unresolvedKeys, failures };
}

export function isBugType(
  typeName: string | undefined,
  bugTypes: string[] = DEFAULT_BUG_TYPES
): boolean {
  if (!typeName) return false;
  const lowered = typeName.toLowerCase();
  return bugTypes.some((t) => t.toLowerCase() === lowered);
}

export interface ApplyJiraClassificationResult {
  /** True only when every Jira batch succeeded. */
  classified: boolean;
  /** Keys to keep in the index. */
  keptKeys: string[];
  /** Resolved keys whose type is not a defect. */
  droppedNonBugs: number;
  /** Unresolved keys dropped when classified (not counted as non-bugs). */
  unresolvedDropped: number;
}

/**
 * Decides whether classification succeeded and which keys survive filtering.
 * Failed batches leave the index unclassified and unfiltered so consumers
 * abstain rather than treating a partial result as "no defects".
 */
export function applyJiraClassification(
  keys: string[],
  types: Map<string, string>,
  unresolved: string[],
  failures: string[],
  bugTypes: string[] = DEFAULT_BUG_TYPES
): ApplyJiraClassificationResult {
  if (failures.length > 0) {
    return {
      classified: false,
      keptKeys: [...keys],
      droppedNonBugs: 0,
      unresolvedDropped: 0,
    };
  }

  const unresolvedSet = new Set(unresolved);
  const keptKeys: string[] = [];
  let droppedNonBugs = 0;
  let unresolvedDropped = 0;

  for (const key of keys) {
    if (unresolvedSet.has(key) || !types.has(key)) {
      unresolvedDropped++;
      continue;
    }
    if (isBugType(types.get(key), bugTypes)) {
      keptKeys.push(key);
    } else {
      droppedNonBugs++;
    }
  }

  return {
    classified: true,
    keptKeys,
    droppedNonBugs,
    unresolvedDropped,
  };
}
