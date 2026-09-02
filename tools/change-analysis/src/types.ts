import type { Finding, ProjectImpact, ProviderOutput } from './risk/types';

export interface ResolvedRefs {
  base: string;
  head: string;
  branch: string;
  remoteRef: string;
}

export interface ReportMeta {
  generatedAt: string;
  branch: string;
  remoteRef: string;
  mergeBase: string;
  base: string;
  head: string;
  resolvedHead: string;
  shallowRepo: boolean;
}

export interface ReportDiff {
  totalFiles: number;
  changedFiles: string[];
}

export interface ReportNx {
  impactedProjects: ProjectImpact[];
  affectedCommand: string;
}

export interface ReportData {
  meta: ReportMeta;
  diff: ReportDiff;
  nx: ReportNx;
  providers: ProviderOutput[];
  findings: Finding[];
}
