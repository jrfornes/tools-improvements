import { createProjectGraphAsync } from '@nx/devkit';
import type { ProjectGraph } from '@nx/devkit';
import type { ProjectImpact } from '../risk/types';

export async function getProjectGraph(): Promise<ProjectGraph> {
  return createProjectGraphAsync();
}

export function mapFilesToProjects(
  graph: ProjectGraph,
  files: string[]
): ProjectImpact[] {
  const impacts = new Map<string, string[]>();

  for (const [name, node] of Object.entries(graph.nodes)) {
    const root = node.data?.root;
    if (!root) continue;
    const normalizedRoot = root.endsWith('/') ? root : `${root}/`;

    for (const file of files) {
      if (file === root || file.startsWith(normalizedRoot)) {
        if (!impacts.has(name)) impacts.set(name, []);
        impacts.get(name)!.push(file);
      }
    }
  }

  return [...impacts.entries()].map(([project, projectFiles]) => ({
    project,
    files: projectFiles,
  }));
}
