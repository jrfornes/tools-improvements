import * as fs from 'fs';
import * as path from 'path';
import { hasFlag, parseArgs } from '../../shared/parse-args';
import { buildBugIndex } from './build-bug-index';
import { DEFAULT_BUG_TYPES } from './jira-classifier';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const jira = hasFlag(args, 'jira');
  const bugTypes = args['bug-types']
    ? args['bug-types']
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : DEFAULT_BUG_TYPES;

  const index = await buildBugIndex({
    since: args['since'] ?? '365 days ago',
    bugPattern: args['pattern'] ?? '[A-Z]+-\\d+',
    tag: args['tag'],
    tagPattern: args['tag-pattern'],
    jira,
    bugTypes,
  });

  const outDir = path.join(process.cwd(), 'tools', '.data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'bugs-index.json'),
    JSON.stringify(index, null, 2),
    'utf-8'
  );

  const scope = index.classified
    ? `${index.totalBugs} defect(s)`
    : `${index.totalBugs} ticket(s), UNCLASSIFIED`;
  console.log(
    `bugs-index: ${scope}, ${index.totalCommits} commit(s) — written to tools/.data/bugs-index.json`
  );

  if (index.classified && index.classification) {
    const c = index.classification;
    console.log(
      `  classified against Jira: ${c.resolvedKeys} resolved, ${c.droppedNonBugs} non-defect(s) dropped, ${c.unresolvedKeys} unresolved`
    );
  } else if (index.classification) {
    const c = index.classification;
    console.warn(
      `  Jira classification incomplete (${c.failures.length} failure(s), ${c.resolvedKeys} resolved, ${c.unresolvedKeys} unresolved) — index left UNCLASSIFIED; change-analysis will treat it as unavailable.`
    );
    for (const failure of c.failures) {
      console.warn(`  warning: ${failure}`);
    }
  } else {
    console.log(
      '  no Jira classification — change-analysis will treat this index as unavailable. Re-run with --jira.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
