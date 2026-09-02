/**
 * Parses `--key value`, `--key=value` and bare `--flag` forms.
 *
 * Both forms matter: Nx's run-commands executor forwards arguments in whichever
 * shape the caller typed, so `nx run change-analysis:run --base=origin/main`
 * reaches this script as `--base=origin/main`. The previous parser only
 * understood the space-separated form, which meant every override passed by
 * ci/Jenkinsfile was silently dropped.
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const body = token.slice(2);
    if (body.length === 0) continue;

    const eq = body.indexOf('=');
    if (eq !== -1) {
      result[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[body] = next;
      i++;
    } else {
      // Bare flag, e.g. `--jira`.
      result[body] = 'true';
    }
  }

  return result;
}

export function hasFlag(args: Record<string, string>, name: string): boolean {
  const value = args[name];
  return value !== undefined && value !== 'false';
}
