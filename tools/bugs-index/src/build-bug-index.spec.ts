import { extractBugKeys } from './build-bug-index';

describe('extractBugKeys', () => {
  const pattern = '[A-Z]+-\\d+';

  it('extracts every issue key referenced in a commit subject', () => {
    expect(extractBugKeys('ACME-123: fix login', pattern)).toEqual([
      'ACME-123',
    ]);
  });

  it('uppercases matched keys so case differences do not create duplicate entries', () => {
    // The default pattern is case-sensitive ([A-Z]), so this only matters for a
    // custom --pattern that permits lowercase, e.g. one tolerant of "acme-1".
    const caseInsensitivePattern = '[A-Za-z]+-\\d+';
    expect(
      extractBugKeys('Acme-1: fix login, see also acme-1', caseInsensitivePattern)
    ).toEqual(['ACME-1']);
  });

  it('dedupes repeated keys within one message', () => {
    expect(
      extractBugKeys('ACME-1: fix login, follow-up to ACME-1', pattern)
    ).toEqual(['ACME-1']);
  });

  it('finds every distinct key in a multi-ticket message', () => {
    expect(extractBugKeys('ACME-1, ACME-2: merge two fixes', pattern)).toEqual(
      ['ACME-1', 'ACME-2']
    );
  });

  it('returns an empty array when the message has no matching key', () => {
    expect(extractBugKeys('cleanup unused imports', pattern)).toEqual([]);
  });

  it('honours a custom pattern', () => {
    expect(extractBugKeys('BUG#42 fixed', 'BUG#\\d+')).toEqual(['BUG#42']);
  });
});
