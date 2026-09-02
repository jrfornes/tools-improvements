import {
  SEVERITY_ORDER,
  type Finding,
  type PlanInput,
  type ProviderOutput,
  type RiskProvider,
} from './types';

export interface CollectResult {
  providers: ProviderOutput[];
  findings: Finding[];
}

function findingKey(finding: Finding): string {
  return [
    finding.providerId,
    finding.kind,
    (finding.files ?? []).join('|'),
    finding.title,
  ].join('::');
}

/**
 * Sorts by severity, then provider, then title, so report output is stable
 * across runs and diffable between builds.
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byProvider = a.providerId.localeCompare(b.providerId);
    if (byProvider !== 0) return byProvider;
    return a.title.localeCompare(b.title);
  });
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

/**
 * A provider that throws must not take the whole run down — it degrades to an
 * `unavailable` entry so the failure is visible in the report instead of silent.
 */
async function runProvider(
  provider: RiskProvider,
  input: PlanInput
): Promise<ProviderOutput> {
  try {
    return await provider.compute(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: provider.id,
      label: provider.label,
      status: 'unavailable',
      reason: `Provider failed: ${message}`,
      summary: 'Not evaluated',
      findings: [],
    };
  }
}

export async function collectFindings(
  input: PlanInput,
  providers: RiskProvider[]
): Promise<CollectResult> {
  const outputs = await Promise.all(
    providers.map((provider) => runProvider(provider, input))
  );

  const findings = sortFindings(
    dedupeFindings(outputs.flatMap((output) => output.findings))
  );

  return { providers: outputs, findings };
}
