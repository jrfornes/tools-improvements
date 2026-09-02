import type { ProjectGraph } from '@nx/devkit';

export interface ProjectImpact {
  project: string;
  files: string[];
}

export interface PlanInput {
  base: string;
  head: string;
  authorEmail?: string;
  changedFiles: string[];
  impactedProjectsCount: number;
  nxGraph?: ProjectGraph;
  impacts?: ProjectImpact[];
  /** History-based providers degrade to `unavailable` when the clone is shallow. */
  shallowRepo?: boolean;
}

export type Severity = 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export interface Finding {
  providerId: string;
  /** Stable machine key, e.g. 'missing-spec'. Used for dedup and future filtering. */
  kind: string;
  severity: Severity;
  /** One actionable line. */
  title: string;
  /** Why we believe it — the part a reviewer can check. */
  evidence: string;
  files?: string[];
}

export type ProviderStatus = 'ok' | 'unavailable' | 'not-applicable';

export interface ProviderOutput {
  id: string;
  label: string;
  status: ProviderStatus;
  /** Required when status !== 'ok'. */
  reason?: string;
  /** Context line, always present. */
  summary: string;
  findings: Finding[];
  details?: Record<string, unknown>;
}

export interface RiskProvider {
  id: string;
  label: string;
  compute(input: PlanInput): Promise<ProviderOutput>;
}
