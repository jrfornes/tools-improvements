import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findCoverageReport, formatAge, isSourceTsFile } from './test-coverage';

describe('isSourceTsFile', () => {
  it.each([
    ['src/foo.ts', true],
    ['src/foo.spec.ts', false],
    ['src/foo.d.ts', false],
    ['src/foo.cy.ts', false], // Cypress spec, not a unit-tested source file
    ['src/foo.tsx', false],
  ])('%s -> %s', (file, expected) => {
    expect(isSourceTsFile(file)).toBe(expected);
  });
});

describe('formatAge', () => {
  it('renders sub-hour ages in minutes, minimum 1', () => {
    expect(formatAge(1_000)).toBe('1m');
    expect(formatAge(30 * 60_000)).toBe('30m');
  });

  it('renders sub-day ages in hours', () => {
    expect(formatAge(5 * 60 * 60_000)).toBe('5h');
  });

  it('renders multi-day ages in days', () => {
    expect(formatAge(3 * 24 * 60 * 60_000)).toBe('3d');
  });
});

describe('findCoverageReport', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null when there is no coverage directory', () => {
    expect(findCoverageReport(root)).toBeNull();
  });

  it('finds a report nested under coverage/', () => {
    const dir = path.join(root, 'coverage', 'tools', 'change-analysis');
    fs.mkdirSync(dir, { recursive: true });
    const reportPath = path.join(dir, 'coverage-final.json');
    fs.writeFileSync(reportPath, '{}');

    expect(findCoverageReport(root)).toBe(reportPath);
  });

  // A stale report from an unrelated project's earlier run must not win over
  // one that was actually just produced by this build.
  it('picks the most recently written report when more than one exists', async () => {
    const staleDir = path.join(root, 'coverage', 'stale-project');
    const freshDir = path.join(root, 'coverage', 'fresh-project');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });

    const stalePath = path.join(staleDir, 'coverage-final.json');
    const freshPath = path.join(freshDir, 'coverage-final.json');
    fs.writeFileSync(stalePath, '{}');
    // Ensure a distinct, later mtime than the "stale" file.
    await new Promise((resolve) => setTimeout(resolve, 10));
    fs.writeFileSync(freshPath, '{}');

    expect(findCoverageReport(root)).toBe(freshPath);
  });
});
