import { hasFlag, parseArgs } from './parse-args';

describe('parseArgs', () => {
  it('parses the space-separated form documented in the README', () => {
    expect(parseArgs(['--base', 'origin/main', '--head', 'HEAD'])).toEqual({
      base: 'origin/main',
      head: 'HEAD',
    });
  });

  // Regression: ci/Jenkinsfile passes --base=origin/$CHANGE_TARGET, and Nx
  // forwards arguments in whichever form the caller typed. The original parser
  // only understood the space form, so every CI override was silently dropped
  // and the tool fell back to comparing against origin/main.
  it('parses the equals form used by ci/Jenkinsfile', () => {
    expect(parseArgs(['--base=origin/main', '--head=HEAD'])).toEqual({
      base: 'origin/main',
      head: 'HEAD',
    });
  });

  it('parses both forms mixed together', () => {
    expect(
      parseArgs(['--base=origin/release', '--head', 'HEAD', '--format=short'])
    ).toEqual({ base: 'origin/release', head: 'HEAD', format: 'short' });
  });

  it('treats a trailing option with no value as a boolean flag', () => {
    expect(parseArgs(['--jira'])).toEqual({ jira: 'true' });
    expect(parseArgs(['--jira', '--since', '30 days ago'])).toEqual({
      jira: 'true',
      since: '30 days ago',
    });
  });

  it('keeps values containing an equals sign intact', () => {
    expect(parseArgs(['--pattern=^[A-Z]+-\\d+=x'])).toEqual({
      pattern: '^[A-Z]+-\\d+=x',
    });
  });

  it('preserves an explicitly empty value', () => {
    expect(parseArgs(['--author='])).toEqual({ author: '' });
  });

  it('ignores positional arguments and a bare --', () => {
    expect(parseArgs(['run', '--', '--base', 'x'])).toEqual({ base: 'x' });
  });

  it('returns an empty object for no arguments', () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe('hasFlag', () => {
  it('is true for a bare flag and for an explicit true', () => {
    expect(hasFlag({ jira: 'true' }, 'jira')).toBe(true);
    expect(hasFlag({ jira: 'yes' }, 'jira')).toBe(true);
  });

  it('is false when absent or explicitly false', () => {
    expect(hasFlag({}, 'jira')).toBe(false);
    expect(hasFlag({ jira: 'false' }, 'jira')).toBe(false);
  });
});
