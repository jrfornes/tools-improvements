# Bugs Index (`bugs-index`)

Builds a local index mapping source files to the Jira issues whose commits
touched them. [`change-analysis`](../change-analysis/) reads this index to tell
a reviewer that changed code has a history of defects.

The index is written to `tools/.data/bugs-index.json` (gitignored).

## Classified vs unclassified

This distinction is the important part of the tool.

The index is built by regex-matching issue keys (`[A-Z]+-\d+`) in commit
subjects. **On its own that finds every referenced ticket, features included** —
it cannot tell a bug from a story. An index in that state is written with
`classified: false`, and `change-analysis` deliberately reports bug history as
_unavailable_ rather than presenting feature tickets as defect history.

Passing `--jira` resolves each issue key's type through the Jira API and keeps
only real defect types. `classified: true` is set **only when every batch
succeeds**. That is the only form `change-analysis` will act on.

If any batch fails, the index stays `classified: false` (all keys kept, no
filtering) so change-analysis reports bug history as unavailable rather than a
false "no defects". Unresolved keys (deleted, moved, or no permission) are
dropped when classification succeeds, but are counted under `unresolvedKeys` —
not `droppedNonBugs`.

Network access happens here, at index-build time. `change-analysis` itself stays
100% offline.

## Usage

```bash
# Unclassified — fast, offline, but change-analysis will not use it for findings
npx nx run bugs-index:build

# Classified — requires Jira credentials
export JIRA_EMAIL='you@example.com'
export JIRA_API_TOKEN='...'
export JIRA_SITE='https://cloud-cs.atlassian.net'   # optional, this is the default
npx nx run bugs-index:build --jira
```

Issue types are resolved in batches of 100 via a single JQL search per batch, so
a year of history costs a handful of requests rather than one per ticket. Each
batch is retried up to twice with backoff before it's counted as failed, so a
single transient blip (a rate limit, a dropped connection) doesn't tax the
whole index the way a persistently broken batch does. A batch that still fails
after retries is reported as a warning and leaves the whole index
unclassified; only a clean run filters down to defects.

## Arguments

| Argument        | Description                                                  | Default        |
| :-------------- | :----------------------------------------------------------- | :------------- |
| `--since`       | How far back to read git history.                            | `365 days ago` |
| `--tag`         | Use `git log <tag>` as the range instead of `--since`.       | —              |
| `--tag-pattern` | Restrict the per-commit tag list to tags matching this glob. | —              |
| `--pattern`     | Regex used to find issue keys in commit subjects.            | `[A-Z]+-\d+`   |
| `--jira`        | Resolve issue types via Jira and keep only defects.          | off            |
| `--bug-types`   | Comma-separated issue types treated as defects.              | `Bug,Defect`   |

Both `--key value` and `--key=value` forms are accepted.

## Output

```jsonc
{
  "generatedAt": "2026-09-02T10:00:00.000Z",
  "source": "git-history",
  "sinceDays": "365 days ago",
  "bugPattern": "[A-Z]+-\\d+",
  "classified": true,
  "classification": {
    "bugTypes": ["Bug", "Defect"],
    "resolvedKeys": 412,
    "unresolvedKeys": 3,
    "droppedNonBugs": 297,
    "failures": []
  },
  "totalBugs": 115,
  "totalCommits": 486,
  "bugs": [
    {
      "key": "ACME-25022",
      "issueType": "Bug",
      "commits": 4,
      "files": ["apps/acme/src/app/foo.service.ts"],
      "lastSeen": "2026-08-24T09:12:00+02:00",
      "commitDetails": [{ "hash": "a1b2c3d", "date": "...", "author": "...", "message": "...", "tags": [] }]
    }
  ],
  "byFile": {
    "apps/acme/src/app/foo.service.ts": ["ACME-25022"]
  }
}
```
