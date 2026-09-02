import { parseCommitFileLists } from './logical-coupling';

const SEP = '';

/** Builds the raw text `git log --format=<SEP>%H --name-only --full-diff`
 *  would produce for a list of (hash, files) pairs. */
function gitLogOutput(commits: Array<{ hash: string; files: string[] }>): string {
  return commits
    .map(({ hash, files }) => [`${SEP}${hash}`, '', ...files, ''].join('\n'))
    .join('\n');
}

describe('parseCommitFileLists', () => {
  it('parses a single commit with several files', () => {
    const raw = gitLogOutput([
      { hash: 'abc123', files: ['a.ts', 'b.ts'] },
    ]);
    expect(parseCommitFileLists(raw)).toEqual([
      { hash: 'abc123', files: ['a.ts', 'b.ts'] },
    ]);
  });

  it('parses multiple commits in order', () => {
    const raw = gitLogOutput([
      { hash: 'c1', files: ['a.ts'] },
      { hash: 'c2', files: ['a.ts', 'c.ts'] },
      { hash: 'c3', files: ['a.ts', 'd.ts', 'e.ts'] },
    ]);
    expect(parseCommitFileLists(raw)).toEqual([
      { hash: 'c1', files: ['a.ts'] },
      { hash: 'c2', files: ['a.ts', 'c.ts'] },
      { hash: 'c3', files: ['a.ts', 'd.ts', 'e.ts'] },
    ]);
  });

  // A merge commit prints no diff under plain `git log --name-only` (no -m /
  // --first-parent), so it must parse as a record with an empty file list
  // rather than being dropped or merged into the next commit's files.
  it('records a merge commit as an empty file list rather than dropping it', () => {
    const raw = gitLogOutput([
      { hash: 'merge1', files: [] },
      { hash: 'c2', files: ['a.ts'] },
    ]);
    expect(parseCommitFileLists(raw)).toEqual([
      { hash: 'merge1', files: [] },
      { hash: 'c2', files: ['a.ts'] },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCommitFileLists('')).toEqual([]);
  });

  it('ignores anything before the first record marker', () => {
    expect(parseCommitFileLists('stray output\n\n' + gitLogOutput([
      { hash: 'c1', files: ['a.ts'] },
    ]))).toEqual([{ hash: 'c1', files: ['a.ts'] }]);
  });
});
