import type { PlanInput, ProviderOutput, RiskProvider } from '../types';

const ID = 'changeScope';
const LABEL = 'Change volume';

/**
 * Context only. Size alone is not actionable — a reviewer already knows how big
 * the diff is — so this provider reports the number and emits no finding.
 */
export const changeScopeProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `${input.changedFiles.length} file(s) changed across ${input.impactedProjectsCount} project(s)`,
      findings: [],
      details: {
        fileCount: input.changedFiles.length,
        projectCount: input.impactedProjectsCount,
      },
    };
  },
};
