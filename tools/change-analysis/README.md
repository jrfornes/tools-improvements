# Change Analysis (`change-analysis`)

The **Change Analysis** tool inspects a set of code changes (typically a Pull
Request) and reports **findings**: concrete, evidence-backed observations a
reviewer can act on and verify. It runs **100% locally** — no network access, no
AI/LLM.

It deliberately does **not** produce a risk score. See
[Why there is no score](#why-there-is-no-score).

## What it reports

Each finding carries a severity, a one-line title, and the evidence behind it,
so a reviewer can judge for themselves whether it is right.

| Signal                      | Severity      | Fires when                                                                                                                                  |
| :-------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------ |
| **Logical coupling**        | high          | A file that historically changes alongside a changed file is missing from the diff. The closest thing here to a real omission-bug detector. |
| **Test coverage**           | high / medium | A changed source file has no adjacent `.spec.ts`; or measured line coverage is below 80%.                                                   |
| **Bug history**             | high / medium | Changed files were previously touched by a _classified_ Jira defect. High when the defect is under 30 days old.                             |
| **Cyclomatic complexity**   | medium        | A changed `.ts` file has complexity ≥ 25, measured with the TypeScript compiler API.                                                        |
| **Dependency blast radius** | medium        | 10 or more Nx projects transitively depend on the changed code.                                                                             |
| **Author familiarity**      | low           | The author owns under 20% of the last 12 months of commits on every changed file — suggests reviewers who do.                               |

Two further signals are reported as **context only**, because size alone is not
actionable: **change volume** (files and projects touched) and **code churn**
(90-day commit counts, reported for the hottest file rather than averaged).

### Providers can abstain

A provider that cannot run says so instead of scoring zero. A missing bugs
index, a shallow clone, a diff with no TypeScript files, or a provider that
throws all surface under a **Not evaluated** heading with the reason. This
matters: a silent zero reads as "safe", which is the opposite of "unknown".

## Prerequisites

Bug-history findings require a **classified** bugs index:

```bash
npx nx run bugs-index:build --jira
```

Without `--jira` the index contains every referenced Jira key — features
included — so this tool reports bug history as unavailable rather than calling a
feature ticket a defect. See [`tools/bugs-index/`](../bugs-index/README.md).

## Usage

```bash
npx nx run change-analysis:run
```

By default it compares the current branch against the remote main/master branch
using `git merge-base`.

### Arguments

Both `--key value` and `--key=value` forms are accepted.

| Argument   | Description                                 | Default                             |
| :--------- | :------------------------------------------ | :---------------------------------- |
| `--base`   | Base git ref to compare against.            | `merge-base` with the remote branch |
| `--head`   | Head git ref.                               | `HEAD`                              |
| `--author` | Author email, used for familiarity.         | `git config user.email`             |
| `--format` | Terminal output: `full` or `short`.         | `full`                              |
| `--output` | Extra path to write the PR-comment body to. | —                                   |

```bash
npx nx run change-analysis:run --base=origin/main --head=HEAD --format=short
```

## Output

Written to `tools/.data/` (gitignored):

- **report.json** — machine-readable providers and findings.
- **report.md** — the findings report, suitable for rendering in a PR or CI summary.
- The `--output` path, if given, receives the PR-comment body (same content plus
  a stable marker so CI can update its previous comment instead of stacking new ones).

```text
Change Analysis — 3 finding(s) (1 high, 2 medium)
42 file(s), 5 project(s)

HIGH:
  - libs/shared/table/src/lib/table.component.html usually changes with
    libs/shared/table/src/lib/table.component.ts, but is not in this diff
    Changed together in 12 of the last 14 commit(s) touching
    table.component.ts (86%). Confirm the omission is intentional.

Context:
  Change volume              42 file(s) changed across 5 project(s)
  Code churn (90d)           131 commit(s) in 90d; hottest table.component.ts (17)

Not evaluated:
  Bug history                No bugs index — run: nx run bugs-index:build --jira
```

## CI

Wired into [`ci/Jenkinsfile`](../../ci/Jenkinsfile) as an **advisory-only**
stage: it archives `report.md` and posts the findings as a Bitbucket PR comment
via [`ci/post-pr-comment.mjs`](../../ci/post-pr-comment.mjs), and **never fails
the build**. Re-runs update the existing comment rather than adding a new one.

The stage is opt-in — `SKIP_CHANGE_ANALYSIS` defaults to `true` — until the
findings have proven themselves on real PRs. It requires two Jenkins
credentials: `bitbucket-pr-token` (needs `pullrequest:write`) and
`jira-api-token`. If either is missing, the stage logs a warning and continues.

## Why there is no score

Earlier versions produced a 0–10 score with `LOW`/`MEDIUM`/`HIGH` levels. It was
removed because it could not be justified:

- **The weighting suppressed its own strongest signal.** The score was a
  weighted mean over 8 providers totalling 13.5 weight, so the heaviest factor
  (bug history, weight 3.0) topped out at 2.2/10 on its own. A file with four
  recent defects and nothing else remarkable scored `LOW`. Risk behaves more
  like a max than a mean — one severe signal should be able to carry the verdict.
- **Non-applicable providers voted "safe".** A provider with nothing to say
  returned 0, which is indistinguishable from "measured, and fine", and dragged
  the mean down.
- **Every threshold was a guess.** The weights, the normalisation divisors and
  the `LOW`/`MEDIUM`/`HIGH` cutoffs were hand-picked and never validated against
  this repo's actual defect history. `4.7/10` implied a precision that did not exist.

A findings list has none of these problems: each item stands or falls on its own
stated evidence. A score may return once there is labelled defect data to
calibrate one against.
