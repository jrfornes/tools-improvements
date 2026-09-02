import type { Finding, ProviderOutput, Severity } from '../risk/types';
import type { ReportData } from '../types';

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export function groupBySeverity(
  findings: Finding[]
): Array<[Severity, Finding[]]> {
  const order: Severity[] = ['high', 'medium', 'low'];
  return order
    .map(
      (severity) =>
        [severity, findings.filter((f) => f.severity === severity)] as [
          Severity,
          Finding[]
        ]
    )
    .filter(([, group]) => group.length > 0);
}

export function countsBySeverity(findings: Finding[]): string {
  const groups = groupBySeverity(findings);
  if (groups.length === 0) return 'no findings';
  return groups
    .map(([severity, group]) => `${group.length} ${severity}`)
    .join(', ');
}

export function degradedProviders(
  providers: ProviderOutput[]
): ProviderOutput[] {
  return providers.filter((p) => p.status === 'unavailable');
}

/**
 * Markdown body shared by report.md and the PR comment. Findings only — the
 * numeric risk score was removed because it was never calibrated against real
 * defect data and its weighted mean suppressed its own strongest signal.
 */
export function renderMarkdown(data: ReportData): string {
  const lines: string[] = ['# Change Analysis', ''];

  const { findings, providers, diff, nx, meta } = data;

  lines.push(
    `**${findings.length} finding(s)** — ${countsBySeverity(findings)}.`,
    '',
    `\`${meta.base.slice(0, 7)}\` → \`${meta.resolvedHead.slice(0, 7)}\` · ${
      diff.totalFiles
    } file(s) · ${nx.impactedProjects.length} project(s)`,
    ''
  );

  if (findings.length === 0) {
    lines.push(
      'No findings. Nothing in the heuristics flagged this change.',
      ''
    );
  }

  for (const [severity, group] of groupBySeverity(findings)) {
    lines.push(`## ${SEVERITY_LABEL[severity]}`, '');
    for (const finding of group) {
      lines.push(`- **${finding.title}**`);
      lines.push(`  ${finding.evidence}`);
      if (finding.files?.length) {
        lines.push(`  ${finding.files.map((f) => `\`${f}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## Context', '');
  for (const provider of providers) {
    if (provider.status === 'ok') {
      lines.push(`- **${provider.label}:** ${provider.summary}`);
    }
  }
  lines.push('');

  const degraded = degradedProviders(providers);
  if (degraded.length > 0) {
    lines.push('## Not evaluated', '');
    for (const provider of degraded) {
      lines.push(
        `- **${provider.label}:** ${provider.reason ?? 'unavailable'}`
      );
    }
    lines.push('');
  }

  lines.push('## Run affected', '', '```bash', nx.affectedCommand, '```', '');

  return lines.join('\n');
}
