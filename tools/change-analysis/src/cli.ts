import { parseArgs } from '../../shared/parse-args';
import { orchestrate } from './core/orchestrate';
import { buildReport } from './report/build-report';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const data = await orchestrate({
    baseOverride: args['base'],
    headOverride: args['head'],
    authorOverride: args['author'],
  });

  const format = (args['format'] ?? 'full') === 'short' ? 'short' : 'full';
  buildReport(data, { format, outputPath: args['output'] });
}

// Analysis is advisory: a crash is reported, but findings never fail a build.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
