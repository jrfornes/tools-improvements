import type { ProjectGraph } from '@nx/devkit';
import { blastRadiusProvider, findDependents } from './blast-radius';
import type { PlanInput } from '../types';

function graphOf(dependencies: Record<string, string[]>): ProjectGraph {
  return {
    nodes: {},
    dependencies: Object.fromEntries(
      Object.entries(dependencies).map(([source, targets]) => [
        source,
        targets.map((target) => ({ source, target, type: 'static' as const })),
      ])
    ),
  } as unknown as ProjectGraph;
}

describe('findDependents', () => {
  // Regression: the original implementation deleted each node from `visited`
  // as its recursive frame unwound, so the returned set was always empty and
  // this provider reported "0 project(s) depend on changed code" for every
  // change ever analysed.
  it('returns transitive dependents rather than an empty set', () => {
    const graph = graphOf({
      app: ['feature'],
      feature: ['ui-lib'],
      other: ['ui-lib'],
      'ui-lib': [],
    });

    expect(findDependents(graph, 'ui-lib')).toEqual(
      new Set(['feature', 'other', 'app'])
    );
  });

  it('excludes the seed project itself', () => {
    const graph = graphOf({ app: ['ui-lib'], 'ui-lib': [] });
    expect(findDependents(graph, 'ui-lib').has('ui-lib')).toBe(false);
  });

  it('resolves a diamond without double counting', () => {
    const graph = graphOf({
      top: ['left', 'right'],
      left: ['base'],
      right: ['base'],
      base: [],
    });
    expect(findDependents(graph, 'base')).toEqual(
      new Set(['left', 'right', 'top'])
    );
  });

  it('terminates on a dependency cycle', () => {
    const graph = graphOf({ a: ['b'], b: ['c'], c: ['a'] });
    expect(findDependents(graph, 'a')).toEqual(new Set(['b', 'c']));
  });

  it('returns an empty set for a project nothing depends on', () => {
    const graph = graphOf({ app: ['lib'], lib: [] });
    expect(findDependents(graph, 'app')).toEqual(new Set());
  });
});

describe('blastRadiusProvider', () => {
  const baseInput: PlanInput = {
    base: 'BASE',
    head: 'HEAD',
    changedFiles: ['libs/ui/src/index.ts'],
    impactedProjectsCount: 1,
  };

  it('is not-applicable when no file maps to a project', async () => {
    const result = await blastRadiusProvider.compute({
      ...baseInput,
      nxGraph: graphOf({}),
      impacts: [],
    });
    expect(result.status).toBe('not-applicable');
    expect(result.findings).toEqual([]);
  });

  it('is unavailable when the graph could not be resolved', async () => {
    const result = await blastRadiusProvider.compute(baseInput);
    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/project graph/i);
  });

  it('reports dependents without a finding below the threshold', async () => {
    const result = await blastRadiusProvider.compute({
      ...baseInput,
      nxGraph: graphOf({ app: ['ui-lib'], 'ui-lib': [] }),
      impacts: [{ project: 'ui-lib', files: ['libs/ui/src/index.ts'] }],
    });
    expect(result.status).toBe('ok');
    expect(result.summary).toContain('1 project(s)');
    expect(result.findings).toEqual([]);
  });

  it('raises a finding once enough projects depend on the change', async () => {
    const dependencies: Record<string, string[]> = { 'ui-lib': [] };
    for (let i = 0; i < 12; i++) dependencies[`app-${i}`] = ['ui-lib'];

    const result = await blastRadiusProvider.compute({
      ...baseInput,
      nxGraph: graphOf(dependencies),
      impacts: [{ project: 'ui-lib', files: ['libs/ui/src/index.ts'] }],
    });

    expect(result.status).toBe('ok');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('medium');
    expect(result.findings[0].kind).toBe('wide-blast-radius');
    expect(result.findings[0].title).toContain('12');
  });
});
