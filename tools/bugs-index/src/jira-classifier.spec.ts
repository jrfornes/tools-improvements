import {
  chunk,
  classifyIssueKeys,
  DEFAULT_BUG_TYPES,
  isBugType,
  JIRA_BATCH_SIZE,
  jiraConfigFromEnv,
  type JiraConfig,
} from './jira-classifier';

const config: JiraConfig = {
  site: 'https://example.atlassian.net',
  email: 'x@y.z',
  apiToken: 't',
};

describe('chunk', () => {
  it('splits into batches of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('rejects a non-positive size rather than looping forever', () => {
    expect(() => chunk([1], 0)).toThrow(/positive/);
  });
});

describe('isBugType', () => {
  it('matches defect types case-insensitively', () => {
    expect(isBugType('Bug')).toBe(true);
    expect(isBugType('defect')).toBe(true);
  });

  it('rejects feature work and unknown types', () => {
    expect(isBugType('Story')).toBe(false);
    expect(isBugType('Task')).toBe(false);
    expect(isBugType(undefined)).toBe(false);
  });

  it('honours a custom type list', () => {
    expect(isBugType('Incident', ['Incident'])).toBe(true);
    expect(isBugType('Bug', ['Incident'])).toBe(false);
  });
});

describe('jiraConfigFromEnv', () => {
  it('returns null when credentials are absent', () => {
    expect(jiraConfigFromEnv({})).toBeNull();
    expect(jiraConfigFromEnv({ JIRA_EMAIL: 'a@b.c' })).toBeNull();
  });

  it('builds a config and strips a trailing slash from the site', () => {
    expect(
      jiraConfigFromEnv({
        JIRA_EMAIL: 'a@b.c',
        JIRA_API_TOKEN: 'tok',
        JIRA_SITE: 'https://example.atlassian.net/',
      })
    ).toEqual({
      site: 'https://example.atlassian.net',
      email: 'a@b.c',
      apiToken: 'tok',
    });
  });
});

describe('classifyIssueKeys', () => {
  it('batches requests at the Jira page limit', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `ACME-${i}`);
    const batches: string[][] = [];

    await classifyIssueKeys(keys, config, async (batch) => {
      batches.push(batch);
      return {
        issues: batch.map((key) => ({
          key,
          fields: { issuetype: { name: 'Bug' } },
        })),
      };
    });

    expect(batches.map((b) => b.length)).toEqual([
      JIRA_BATCH_SIZE,
      JIRA_BATCH_SIZE,
      50,
    ]);
  });

  it('maps returned keys to their issue type', async () => {
    const result = await classifyIssueKeys(
      ['ACME-1', 'ACME-2'],
      config,
      async () => ({
        issues: [
          { key: 'ACME-1', fields: { issuetype: { name: 'Bug' } } },
          { key: 'ACME-2', fields: { issuetype: { name: 'Story' } } },
        ],
      })
    );

    expect(result.types.get('ACME-1')).toBe('Bug');
    expect(result.types.get('ACME-2')).toBe('Story');
    expect(result.unresolvedKeys).toEqual([]);
  });

  it('records keys Jira did not return as unresolved', async () => {
    const result = await classifyIssueKeys(
      ['ACME-1', 'GONE-9'],
      config,
      async () => ({
        issues: [{ key: 'ACME-1', fields: { issuetype: { name: 'Bug' } } }],
      })
    );

    expect(result.unresolvedKeys).toEqual(['GONE-9']);
  });

  // One failing page must not discard the pages that succeeded.
  it('keeps successful batches when another batch fails', async () => {
    const keys = Array.from({ length: 150 }, (_, i) => `ACME-${i}`);
    let call = 0;

    const result = await classifyIssueKeys(keys, config, async (batch) => {
      call++;
      if (call === 1) throw new Error('429 rate limited');
      return {
        issues: batch.map((key) => ({
          key,
          fields: { issuetype: { name: 'Bug' } },
        })),
      };
    });

    expect(result.types.size).toBe(50);
    expect(result.unresolvedKeys).toHaveLength(100);
    expect(result.failures).toEqual(['429 rate limited']);
  });

  it('defaults to Bug and Defect as the accepted types', () => {
    expect(DEFAULT_BUG_TYPES).toEqual(['Bug', 'Defect']);
  });
});
