import * as fs from 'fs';
import * as path from 'path';
import type { ReportData } from '../types';
import { buildPrComment } from './pr-comment';
import {
  countsBySeverity,
  degradedProviders,
  groupBySeverity,
  SEVERITY_LABEL,
  renderMarkdown,
} from './render';

export interface BuildReportOptions {
  format?: 'short' | 'full';
  /** Extra destination for the PR comment body, used by CI. */
  outputPath?: string;
}

function printShort(data: ReportData): void {
  console.log(
    `${data.findings.length} finding(s) — ${countsBySeverity(
      data.findings
    )} · ${data.diff.totalFiles} file(s), ${
      data.nx.impactedProjects.length
    } project(s)`
  );
  for (const finding of data.findings) {
    console.log(`  [${SEVERITY_LABEL[finding.severity]}] ${finding.title}`);
  }
  console.log(`Run: ${data.nx.affectedCommand}`);
}

function printFull(data: ReportData): void {
  console.log(
    `Change Analysis — ${data.findings.length} finding(s) (${countsBySeverity(
      data.findings
    )})`
  );
  console.log(
    `${data.diff.totalFiles} file(s), ${data.nx.impactedProjects.length} project(s)`
  );
  console.log('');

  if (data.findings.length === 0) {
    console.log('No findings.');
    console.log('');
  }

  for (const [severity, group] of groupBySeverity(data.findings)) {
    console.log(`${SEVERITY_LABEL[severity]}:`);
    for (const finding of group) {
      console.log(`  - ${finding.title}`);
      console.log(`    ${finding.evidence}`);
      if (finding.files?.length) {
        console.log(`    ${finding.files.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('Context:');
  for (const provider of data.providers) {
    if (provider.status === 'ok') {
      console.log(`  ${provider.label.padEnd(26)} ${provider.summary}`);
    }
  }

  const degraded = degradedProviders(data.providers);
  if (degraded.length > 0) {
    console.log('');
    console.log('Not evaluated:');
    for (const provider of degraded) {
      console.log(
        `  ${provider.label.padEnd(26)} ${provider.reason ?? 'unavailable'}`
      );
    }
  }

  console.log('');
  console.log('Run affected:');
  console.log(`  ${data.nx.affectedCommand}`);
}

export function buildReport(data: ReportData, opts?: BuildReportOptions): void {
  const outDir = path.join(process.cwd(), 'tools', '.data');
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(outDir, 'report.md'),
    renderMarkdown(data),
    'utf-8'
  );

  if (opts?.outputPath) {
    const target = path.resolve(process.cwd(), opts.outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buildPrComment(data), 'utf-8');
  }

  if ((opts?.format ?? 'full') === 'short') {
    printShort(data);
  } else {
    printFull(data);
  }

  console.log('');
  console.log(`report.json and report.md written to ${outDir}`);
}
