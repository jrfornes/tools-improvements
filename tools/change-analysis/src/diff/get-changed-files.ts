import simpleGit from 'simple-git';

export function isIgnoredPath(file: string): boolean {
  return file.endsWith('.lock') || file === 'package-lock.json';
}

export function parseDiffOutput(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !isIgnoredPath(l));
}

export async function getChangedFiles(
  base: string,
  head: string,
  repoRoot = process.cwd()
): Promise<string[]> {
  const git = simpleGit(repoRoot);
  // Three-dot: diff head against the merge-base, so an explicitly passed base
  // that has since advanced does not report files this branch never touched.
  // --diff-filter=d drops deletions — a deleted file must not produce findings
  // like "add unit tests for <file>".
  const raw = await git.raw([
    'diff',
    `${base}...${head}`,
    '--name-only',
    '--diff-filter=d',
  ]);
  return parseDiffOutput(raw);
}
