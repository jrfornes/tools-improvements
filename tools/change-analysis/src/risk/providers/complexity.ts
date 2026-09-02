import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type {
  Finding,
  PlanInput,
  ProviderOutput,
  RiskProvider,
} from '../types';

const ID = 'complexity';
const LABEL = 'Cyclomatic complexity';

const COMPLEXITY_THRESHOLD = 25;
const MAX_FINDINGS = 3;

function isTsSourceFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.cy.ts') &&
    !file.endsWith('.d.ts')
  );
}

export function calculateCyclomaticComplexity(
  sourceFile: ts.SourceFile
): number {
  let complexity = 1;

  function walk(node: ts.Node): void {
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCatchClause(node) ||
      ts.isCaseClause(node)
    ) {
      complexity++;
    }

    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity++;
      }
    }

    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
  return complexity;
}

export const complexityProvider: RiskProvider = {
  id: ID,
  label: LABEL,
  async compute(input: PlanInput): Promise<ProviderOutput> {
    const targetFiles = input.changedFiles.filter(isTsSourceFile);

    if (targetFiles.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'not-applicable',
        reason: 'No changed TypeScript source files',
        summary: 'No TypeScript source files in this change',
        findings: [],
      };
    }

    const byFile: Array<{ file: string; complexity: number }> = [];
    for (const file of targetFiles) {
      const abs = path.join(process.cwd(), file);
      if (!fs.existsSync(abs)) continue;
      const sourceFile = ts.createSourceFile(
        file,
        fs.readFileSync(abs, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      byFile.push({
        file,
        complexity: calculateCyclomaticComplexity(sourceFile),
      });
    }

    if (byFile.length === 0) {
      return {
        id: ID,
        label: LABEL,
        status: 'not-applicable',
        reason: 'No readable TypeScript source files',
        summary: 'No readable TypeScript source files',
        findings: [],
      };
    }

    // Max, not mean: one very complex file matters even in a large diff.
    const sorted = [...byFile].sort((a, b) => b.complexity - a.complexity);
    const worst = sorted[0];

    const findings: Finding[] = sorted
      .filter((item) => item.complexity >= COMPLEXITY_THRESHOLD)
      .slice(0, MAX_FINDINGS)
      .map((item) => ({
        providerId: ID,
        kind: 'high-complexity',
        severity: 'medium' as const,
        title: `High branching complexity in ${item.file}`,
        evidence: `Cyclomatic complexity ${item.complexity} (threshold ${COMPLEXITY_THRESHOLD}), counted over the whole file.`,
        files: [item.file],
      }));

    return {
      id: ID,
      label: LABEL,
      status: 'ok',
      summary: `Highest complexity ${worst.complexity} (${worst.file}) across ${byFile.length} file(s)`,
      findings,
      details: {
        maxComplexity: worst.complexity,
        topFiles: sorted.slice(0, 5),
      },
    };
  },
};
