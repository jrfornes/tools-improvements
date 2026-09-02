import simpleGit from 'simple-git';
import type { ResolvedRefs } from '../types';

export async function resolveRefs(
  repoRoot = process.cwd()
): Promise<ResolvedRefs> {
  const git = simpleGit(repoRoot);

  const branch = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

  const remoteCheck = await git
    .raw(['ls-remote', '--heads', 'origin', branch])
    .catch(() => '');
  const remoteExists = remoteCheck.trim().length > 0;

  const remoteRef = remoteExists ? `origin/${branch}` : 'origin/main';

  const mergeBase = (await git.raw(['merge-base', 'HEAD', remoteRef])).trim();

  return { base: mergeBase, head: 'HEAD', branch, remoteRef };
}
