import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
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

export function isTsSourceFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.cy.ts') &&
    !file.endsWith('.d.ts')
  );
}

/**
 * Complexity is counted over the whole file, so without a base comparison a
 * file that is merely large stays "high complexity" forever — a one-line
 * touch to an old, already-complex file trips this on every PR that ever
 * touches it, which is exactly how a heuristic teaches reviewers to ignore
 * it. Flag it when it's genuinely new (no base version) or this diff made it
 * worse; stay quiet when the diff didn't change the file's complexity.
 */
export function shouldFlagComplexity(
  complexity: number,
  baseComplexity: number | null,
  threshold: number = COMPLEXITY_THRESHOLD
): boolean {
  if (complexity < threshold) return false;
  if (baseComplexity === null) return true;
  return complexity > baseComplexity;
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

    const git = simpleGit(process.cwd());

    // Shallow clones may not hold the base commit's blobs at all, which would
    // make every file look "new" (baseComplexity null) and over-fire. Fall
    // back to plain threshold-only flagging there instead.
    async function baseComplexityFor(file: string): Promise<number | null> {
      if (input.shallowRepo) return null;
      try {
        const content = await git.show([`${input.base}:${file}`]);
        const sourceFile = ts.createSourceFile(
          file,
          content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        return calculateCyclomaticComplexity(sourceFile);
      } catch {
        // Doesn't exist at base (new file, or git show failed) — treated as
        // "no prior complexity to compare against" rather than as 0, so a
        // brand-new complex file still gets flagged.
        return null;
      }
    }

    const byFile: Array<{
      file: string;
      complexity: number;
      baseComplexity: number | null;
    }> = [];
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
      const complexity = calculateCyclomaticComplexity(sourceFile);
      const baseComplexity = input.shallowRepo
        ? null
        : await baseComplexityFor(file);
      byFile.push({ file, complexity, baseComplexity });
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
      .filter((item) =>
        shouldFlagComplexity(item.complexity, item.baseComplexity)
      )
      .slice(0, MAX_FINDINGS)
      .map((item) => {
        const change =
          item.baseComplexity === null
            ? 'new file'
            : `up from ${item.baseComplexity} before this change`;
        return {
          providerId: ID,
          kind: 'high-complexity',
          severity: 'medium' as const,
          title: `High branching complexity in ${item.file}`,
          evidence: `Cyclomatic complexity ${item.complexity} (threshold ${COMPLEXITY_THRESHOLD}), counted over the whole file — ${change}.`,
          files: [item.file],
        };
      });

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
