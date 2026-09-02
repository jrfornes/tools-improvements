#!/usr/bin/env node
/**
 * Post (or update) the Change Analysis findings comment on a Bitbucket PR.
 *
 * Reads a markdown body from a file and publishes it as a pull request comment.
 * If this tool already commented on the PR — identified by the marker line that
 * tools/change-analysis emits — the existing comment is updated in place rather
 * than stacking a new one on every build.
 *
 * Plain Node with global fetch, so it needs nothing beyond the CI image's Node
 * runtime. (ci/check_sprint.py uses Python because it runs under Bitbucket
 * Pipelines, which uses a different image; the Jenkins image has no pip deps.)
 *
 * Advisory: failures are reported on stderr and the process still exits 0, so a
 * Bitbucket outage or a missing token never fails the build. Pass --strict to
 * exit non-zero instead, which is useful when debugging locally.
 *
 * Required environment:
 *   BITBUCKET_USERNAME, BITBUCKET_API_TOKEN   (token needs pullrequest:write)
 *   BITBUCKET_WORKSPACE / BITBUCKET_REPO_OWNER, BITBUCKET_REPO_SLUG
 *
 * PR id comes from --pr-id, or CHANGE_ID (Jenkins), or BITBUCKET_PR_ID.
 *
 * Usage: node ci/post-pr-comment.mjs <body-file> [--pr-id N] [--strict]
 */

import { readFile } from 'node:fs/promises';

const API_BASE = 'https://api.bitbucket.org/2.0';

/** Must match PR_COMMENT_MARKER in tools/change-analysis/src/report/pr-comment.ts */
const MARKER = '<!-- change-analysis -->';

function env(name) {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseCliArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--strict') args.strict = true;
    else if (token === '--pr-id') args.prId = argv[++i];
    else if (token.startsWith('--pr-id='))
      args.prId = token.slice('--pr-id='.length);
    else if (!token.startsWith('--')) args.bodyFile = token;
  }
  return args;
}

function authHeaders() {
  const username = env('BITBUCKET_USERNAME') ?? env('BITBUCKET_USER');
  const apiToken = env('BITBUCKET_API_TOKEN') ?? env('BITBUCKET_ACCESS_TOKEN');
  const appPassword =
    env('BITBUCKET_APP_PASSWORD') ?? env('BITBUCKET_PASSWORD');
  const secret = apiToken ?? appPassword;

  if (username && secret) {
    const encoded = Buffer.from(`${username}:${secret}`, 'utf-8').toString(
      'base64'
    );
    return { Authorization: `Basic ${encoded}` };
  }
  if (apiToken) {
    return { Authorization: `Bearer ${apiToken}` };
  }

  throw new Error(
    'Set BITBUCKET_USERNAME with BITBUCKET_API_TOKEN (or BITBUCKET_APP_PASSWORD).'
  );
}

function resolveTarget(prIdArg) {
  const workspace = env('BITBUCKET_WORKSPACE') ?? env('BITBUCKET_REPO_OWNER');
  const repoSlug = env('BITBUCKET_REPO_SLUG');
  const prId = prIdArg ?? env('CHANGE_ID') ?? env('BITBUCKET_PR_ID');

  if (!workspace || !repoSlug) {
    throw new Error(
      'Set BITBUCKET_WORKSPACE (or BITBUCKET_REPO_OWNER) and BITBUCKET_REPO_SLUG.'
    );
  }
  if (!prId) {
    throw new Error(
      'No pull request id — pass --pr-id, or set CHANGE_ID / BITBUCKET_PR_ID. ' +
        'This build is probably not a pull request.'
    );
  }
  return { workspace, repoSlug, prId };
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `${options.method ?? 'GET'} ${url} returned ${response.status} ${
        response.statusText
      }${detail ? `: ${detail.slice(0, 300)}` : ''}`
    );
  }
  return response.json();
}

async function findExistingComment(baseUrl, headers) {
  let url = `${baseUrl}?pagelen=100`;
  while (url) {
    const payload = await request(url, { headers });
    for (const comment of payload.values ?? []) {
      if (comment.deleted) continue;
      if ((comment.content?.raw ?? '').includes(MARKER)) return comment.id;
    }
    url = payload.next;
  }
  return undefined;
}

async function upsertComment(baseUrl, body, headers) {
  const existingId = await findExistingComment(baseUrl, headers);
  const options = {
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { raw: body } }),
  };

  if (existingId === undefined) {
    const created = await request(baseUrl, { ...options, method: 'POST' });
    return `created comment ${created.id}`;
  }
  await request(`${baseUrl}/${existingId}`, { ...options, method: 'PUT' });
  return `updated comment ${existingId}`;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  try {
    if (!args.bodyFile)
      throw new Error('Usage: post-pr-comment.mjs <body-file>');

    const body = (await readFile(args.bodyFile, 'utf-8')).trim();
    if (!body) throw new Error(`${args.bodyFile} is empty.`);

    const { workspace, repoSlug, prId } = resolveTarget(args.prId);
    const headers = { Accept: 'application/json', ...authHeaders() };
    const baseUrl = `${API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`;

    const result = await upsertComment(baseUrl, body, headers);
    console.log(`change-analysis: ${result} on PR ${prId}`);
    return 0;
  } catch (err) {
    console.error(`change-analysis: could not post PR comment: ${err.message}`);
    return args.strict ? 1 : 0;
  }
}

process.exit(await main());
