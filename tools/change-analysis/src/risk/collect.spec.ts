import { collectFindings, dedupeFindings, sortFindings } from './collect';
import type { Finding, PlanInput, ProviderOutput, RiskProvider } from './types';

const input: PlanInput = {
  base: 'BASE',
  head: 'HEAD',
  changedFiles: ['a.ts'],
  impactedProjectsCount: 1,
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    providerId: 'p',
    kind: 'k',
    severity: 'medium',
    title: 't',
    evidence: 'e',
    ...overrides,
  };
}

function provider(id: string, output: Partial<ProviderOutput>): RiskProvider {
  return {
    id,
    label: id,
    compute: async () => ({
      id,
      label: id,
      status: 'ok',
      summary: '',
      findings: [],
      ...output,
    }),
  };
}

describe('sortFindings', () => {
  it('orders high before medium before low', () => {
    const sorted = sortFindings([
      finding({ severity: 'low', title: 'c' }),
      finding({ severity: 'high', title: 'a' }),
      finding({ severity: 'medium', title: 'b' }),
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(['high', 'medium', 'low']);
  });

  it('breaks ties by provider then title so output is stable', () => {
    const sorted = sortFindings([
      finding({ providerId: 'z', title: 'a' }),
      finding({ providerId: 'a', title: 'b' }),
      finding({ providerId: 'a', title: 'a' }),
    ]);
    expect(sorted.map((f) => `${f.providerId}/${f.title}`)).toEqual([
      'a/a',
      'a/b',
      'z/a',
    ]);
  });
});

describe('dedupeFindings', () => {
  it('collapses identical findings', () => {
    expect(dedupeFindings([finding(), finding()])).toHaveLength(1);
  });

  it('keeps findings that differ by file', () => {
    expect(
      dedupeFindings([
        finding({ files: ['a.ts'] }),
        finding({ files: ['b.ts'] }),
      ])
    ).toHaveLength(2);
  });
});

describe('collectFindings', () => {
  it('aggregates and sorts findings across providers', async () => {
    const result = await collectFindings(input, [
      provider('one', {
        findings: [finding({ providerId: 'one', severity: 'low' })],
      }),
      provider('two', {
        findings: [finding({ providerId: 'two', severity: 'high' })],
      }),
    ]);

    expect(result.findings.map((f) => f.providerId)).toEqual(['two', 'one']);
    expect(result.providers).toHaveLength(2);
  });

  it('passes unavailable providers through without inventing findings', async () => {
    const result = await collectFindings(input, [
      provider('bugHistory', {
        status: 'unavailable',
        reason: 'no index',
        summary: 'Not evaluated',
      }),
    ]);

    expect(result.findings).toEqual([]);
    expect(result.providers[0].status).toBe('unavailable');
    expect(result.providers[0].reason).toBe('no index');
  });

  // A single broken provider must not take down an advisory-only tool.
  it('degrades a throwing provider to unavailable instead of rejecting', async () => {
    const exploding: RiskProvider = {
      id: 'boom',
      label: 'Boom',
      compute: async () => {
        throw new Error('git exploded');
      },
    };

    const result = await collectFindings(input, [exploding]);

    expect(result.providers[0].status).toBe('unavailable');
    expect(result.providers[0].reason).toContain('git exploded');
    expect(result.findings).toEqual([]);
  });
});
