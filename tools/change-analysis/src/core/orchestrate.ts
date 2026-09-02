import simpleGit from 'simple-git';
import { getChangedFiles } from '../diff/get-changed-files';
import { getProjectGraph, mapFilesToProjects } from '../nx/get-project-graph';
import { collectFindings } from '../risk/collect';
import { blastRadiusProvider } from '../risk/providers/blast-radius';
import { bugHistoryProvider } from '../risk/providers/bug-history';
import { changeScopeProvider } from '../risk/providers/change-scope';
import { churnProvider } from '../risk/providers/churn';
import { complexityProvider } from '../risk/providers/complexity';
import { familiarityProvider } from '../risk/providers/familiarity';
import { logicalCouplingProvider } from '../risk/providers/logical-coupling';
import { testCoverageProvider } from '../risk/providers/test-coverage';
import type { ReportData, ResolvedRefs } from '../types';
import { isShallowRepository } from './git-env';
import { resolveRefs } from './resolve-refs';

const PROVIDERS = [
  changeScopeProvider,
  churnProvider,
  blastRadiusProvider,
  bugHistoryProvider,
  complexityProvider,
  testCoverageProvider,
  familiarityProvider,
  logicalCouplingProvider,
];

export interface OrchestrateOptions {
  baseOverride?: string;
  headOverride?: string;
  authorOverride?: string;
}

async function resolveAuthorEmail(override?: string): Promise<string> {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  try {
    const raw = await simpleGit(process.cwd()).raw(['config', 'user.email']);
    return raw.trim();
  } catch {
    return '';
  }
}

export async function orchestrate(
  opts: OrchestrateOptions = {}
): Promise<ReportData> {
  let refs: ResolvedRefs;

  if (opts.baseOverride && opts.headOverride) {
    refs = {
      base: opts.baseOverride,
      head: opts.headOverride,
      branch: opts.baseOverride,
      remoteRef: opts.baseOverride,
    };
  } else {
    refs = await resolveRefs();
  }

  const [changedFiles, graph, shallowRepo, authorEmail] = await Promise.all([
    getChangedFiles(refs.base, refs.head),
    getProjectGraph(),
    isShallowRepository(),
    resolveAuthorEmail(opts.authorOverride),
  ]);

  const impacts = mapFilesToProjects(graph, changedFiles);

  const { providers, findings } = await collectFindings(
    {
      base: refs.base,
      head: refs.head,
      authorEmail: authorEmail || undefined,
      changedFiles,
      impactedProjectsCount: impacts.length,
      nxGraph: graph,
      impacts,
      shallowRepo,
    },
    PROVIDERS
  );

  const resolvedHead = await simpleGit(process.cwd())
    .raw(['rev-parse', refs.head])
    .then((s) => s.trim())
    .catch(() => refs.head);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      branch: refs.branch,
      remoteRef: refs.remoteRef,
      mergeBase: refs.base,
      base: refs.base,
      head: refs.head,
      resolvedHead,
      shallowRepo,
    },
    diff: {
      totalFiles: changedFiles.length,
      changedFiles,
    },
    nx: {
      impactedProjects: impacts,
      affectedCommand: `nx affected --base=${refs.base} --head=${refs.head}`,
    },
    providers,
    findings,
  };
}
