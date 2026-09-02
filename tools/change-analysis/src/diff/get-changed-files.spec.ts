import { isIgnoredPath, parseDiffOutput } from './get-changed-files';

describe('parseDiffOutput', () => {
  it('trims and drops blank lines', () => {
    expect(parseDiffOutput('a.ts\n  b.ts  \n\n')).toEqual(['a.ts', 'b.ts']);
  });

  it('filters lockfiles, which are noise rather than reviewable code', () => {
    expect(parseDiffOutput('package-lock.json\nyarn.lock\nsrc/a.ts')).toEqual([
      'src/a.ts',
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseDiffOutput('')).toEqual([]);
  });
});

describe('isIgnoredPath', () => {
  it.each([
    ['package-lock.json', true],
    ['some/path/deps.lock', true],
    ['src/app.ts', false],
  ])('%s -> %s', (file, expected) => {
    expect(isIgnoredPath(file)).toBe(expected);
  });
});
