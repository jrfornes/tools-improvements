import { applyJiraClassification } from './jira-classifier';

describe('applyJiraClassification', () => {
  it('keeps bugs, drops stories as non-bugs, and drops unresolved without counting them as non-bugs when every batch succeeds', () => {
    const types = new Map([
      ['ACME-1', 'Bug'],
      ['ACME-2', 'Story'],
      ['ACME-3', 'Defect'],
    ]);
    const unresolved = ['ACME-4'];

    const result = applyJiraClassification(
      ['ACME-1', 'ACME-2', 'ACME-3', 'ACME-4'],
      types,
      unresolved,
      [],
      ['Bug', 'Defect']
    );

    expect(result.classified).toBe(true);
    expect(result.keptKeys).toEqual(['ACME-1', 'ACME-3']);
    expect(result.droppedNonBugs).toBe(1);
    expect(result.unresolvedDropped).toBe(1);
  });

  it('leaves the index unclassified and unfiltered when any batch failed', () => {
    const types = new Map([['ACME-1', 'Bug']]);
    const keys = ['ACME-1', 'ACME-2', 'ACME-3'];

    const result = applyJiraClassification(
      keys,
      types,
      ['ACME-2', 'ACME-3'],
      ['Jira /search returned 500'],
      ['Bug', 'Defect']
    );

    expect(result.classified).toBe(false);
    expect(result.keptKeys).toEqual(keys);
    expect(result.droppedNonBugs).toBe(0);
    expect(result.unresolvedDropped).toBe(0);
  });

  it('treats an empty key set with no failures as a successful empty classification', () => {
    const result = applyJiraClassification([], new Map(), [], [], [
      'Bug',
      'Defect',
    ]);

    expect(result.classified).toBe(true);
    expect(result.keptKeys).toEqual([]);
    expect(result.droppedNonBugs).toBe(0);
    expect(result.unresolvedDropped).toBe(0);
  });
});
