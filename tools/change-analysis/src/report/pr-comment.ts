import type { ReportData } from '../types';
import { countsBySeverity, renderMarkdown } from './render';

/**
 * Stable marker so a re-run can find and update its previous comment instead of
 * stacking a new one on every build. ci/post_pr_comment.py greps for this.
 */
export const PR_COMMENT_MARKER = '<!-- change-analysis -->';

export function buildPrComment(data: ReportData): string {
  const summary = `${data.findings.length} finding(s) — ${countsBySeverity(
    data.findings
  )}`;

  return [
    PR_COMMENT_MARKER,
    renderMarkdown(data),
    '---',
    `_Advisory only — ${summary}. This check never blocks a merge._`,
    '',
  ].join('\n');
}
