import simpleGit from 'simple-git';

/**
 * History-based providers (churn, familiarity, logical coupling) silently
 * produce empty results against a shallow clone, which reads as "no risk"
 * rather than "no data". Callers use this to mark them `unavailable` instead.
 */
export async function isShallowRepository(
  repoRoot = process.cwd()
): Promise<boolean> {
  try {
    const raw = await simpleGit(repoRoot).raw([
      'rev-parse',
      '--is-shallow-repository',
    ]);
    return raw.trim() === 'true';
  } catch {
    return false;
  }
}

export const SHALLOW_CLONE_REASON =
  'Shallow clone — git history is truncated, so this signal cannot be computed. ' +
  'Fetch full history (e.g. git fetch --unshallow) to enable it.';
