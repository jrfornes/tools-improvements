import type { ProjectGraph } from '@nx/devkit';
import type { PlanInput, ProviderOutput, RiskProvider } from '../types';

const ID = 'blastRadius';
const LABEL = 'Dependency blast radius';

/** At or above this many transitive dependents, the change is worth flagging. */
const FINDING_THRESHOLD = 10;

/**
 * Walks the reverse dependency edges of the Nx graph and returns every project
 * that transitively depends on `project`, excluding `project` itself.
 *
 * The previous implementation deleted each node from `visited` as its frame
 * unwound, so the set was always empty by the time it was returned and this
 * provider never reported a single dependent.
 */
export function findDependents(
  graph: ProjectGraph,
  project: string
): Set<string> {
  const visited = new Set<string>();
  const stack = [project];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const [dependent, deps] of Object.entries(graph.dependencies ?? {})) {
      if (visited.has(dependent) || dependent === project) continue;
      if (deps.some((d) => d.target === current)) {
        visited.add(dependent);
        stack.push(dependent);
      }
    }
  }

  return visited;
}

export const blastRadiusProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    const graph = input.nxGraph;

    if (!graph) {
      return {
        id: ID,
        label: LABEL,
        status: 'unavailable',
        reason: 'Nx project graph could not be resolved',
        summary: 'Not evaluated',
        findings: [],
      };
    }

    if (!input.impacts || input.impacts.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'not-applicable',
        reason: 'No changed file maps to an Nx project',
        summary: 'No Nx projects impacted',
        findings: [],
      };
    }

    const dependentToSource = new Map<string, string>();
    for (const impact of input.impacts) {
      for (const dependent of findDependents(graph, impact.project)) {
        if (!dependentToSource.has(dependent)) {
          dependentToSource.set(dependent, impact.project);
        }
      }
    }

    // A directly changed project is not "downstream" of the change.
    for (const impact of input.impacts) {
      dependentToSource.delete(impact.project);
    }

    const dependents = [...dependentToSource.keys()].sort();
    const count = dependents.length;
    const shown = dependents.slice(0, 8);
    const summary =
      count === 0
        ? 'No other project depends on the changed code'
        : `${count} project(s) depend on the changed code: ${shown.join(', ')}${
            count > shown.length ? `, +${count - shown.length} more` : ''
          }`;

    const findings =
      count >= FINDING_THRESHOLD
        ? [
            {
              providerId: ID,
              kind: 'wide-blast-radius',
              severity: 'medium' as const,
              title: `Change reaches ${count} downstream project(s)`,
              evidence: `Transitive Nx dependents of ${input.impacts
                .map((i) => i.project)
                .join(', ')}: ${shown.join(', ')}${
                count > shown.length ? `, +${count - shown.length} more` : ''
              }`,
            },
          ]
        : [];

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary,
      findings,
      details: { dependentCount: count, dependents: shown },
    };
  },
};
