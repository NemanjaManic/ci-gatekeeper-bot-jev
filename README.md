# CI Gatekeeper Bot (Jev)

<!-- smoke-test PR: trivial docs-only change to exercise the real Jev pipeline end-to-end -->
<!-- mixed-diff test: this trivial line is paired with an auth-shaped test fixture in the same PR -->


A GitHub Action that uses Jev (TypeSafe AI, via the
Vercel AI Gateway) to cheaply and quickly triage pull requests before an
expensive LLM or human review. See
[`specs/001-jev-pr-triage/`](specs/001-jev-pr-triage/) for the full spec-kit
design (spec, plan, research, data model, contracts, tasks) and
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) for the
project's governing principles.

## What it does

On every `pull_request` event (`opened`, `synchronize`, `reopened`), the
action:

1. Fetches the PR's diff, changed files, and commit messages.
2. Asks Jev four typed questions: `should_review`, `risk`, `route`,
   `touches_secrets`.
3. Applies repo-configurable risk thresholds to compute the final `route`
   (`auto-approve` / `human-review` / `block`).
4. Sets a GitHub commit status reflecting that route.
5. Posts (or updates) a PR comment explaining the decision — never including
   raw diff content, even when a possible secret was detected.
6. For `human-review` PRs at elevated risk, runs a more detailed secondary
   review — by default on whichever language model is cheapest on your AI
   Gateway account at that moment (no vendor hardcoded; configurable) —
   before posting.
7. Logs cost (tokens) and latency for every Jev/secondary-review call.

## Usage

```yaml
name: Jev PR Gatekeeper
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      statuses: write
    steps:
      - uses: NemanjaManic/ci-gatekeeper-bot-jev@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          ai-gateway-api-key: ${{ secrets.AI_GATEWAY_API_KEY }}
```

### Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | yes | — | Token with permission to read PR diff, post comments, set status checks |
| `ai-gateway-api-key` | yes | — | Vercel AI Gateway API key (pass from a repo secret) |
| `risk-threshold-for-review` | no | `cosmetic` | Minimum risk that prevents auto-approve |
| `risk-threshold-for-block` | no | `blocking` | Minimum risk that forces `auto-approve` straight to `block` |
| `fallback-review-risk-threshold` | no | `blocking` | Minimum risk (at `route=human-review`) that triggers the detailed secondary review |
| `fallback-review-model` | no | `""` (auto) | AI Gateway model id for the secondary review (e.g. `openai/gpt-4o-mini`). Empty = auto-pick the cheapest available language model on your account |
| `config-path` | no | `.github/jev-gatekeeper.yml` | Path to an optional repo risk-configuration file |

### Outputs

`route`, `risk`, `touches_secrets` — see
[`specs/001-jev-pr-triage/contracts/action-interface.md`](specs/001-jev-pr-triage/contracts/action-interface.md).

### Repo config file (optional)

```yaml
# .github/jev-gatekeeper.yml
risk_threshold_for_review: cosmetic
risk_threshold_for_block: blocking
fallback_review_risk_threshold: blocking
fallback_review_model: ""  # empty = auto-pick the cheapest available model
sensitive_path_patterns:
  - ".github/workflows/**"
  - "src/auth/**"
  - "migrations/**"
```

Repo config takes precedence over `action.yml` inputs, which take precedence
over built-in conservative defaults.

## Setting up the AI Gateway API key

The action needs an `AI_GATEWAY_API_KEY` value in two different places
depending on what you're doing:

**To run the action for real, in a repo's GitHub Actions workflow:**

1. On GitHub, go to the repo → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
2. Name it `AI_GATEWAY_API_KEY`, paste your Vercel AI Gateway key as the
   value, save.
3. In the workflow YAML, pass it into the action's `ai-gateway-api-key`
   input as `${{ secrets.AI_GATEWAY_API_KEY }}` (see the `Usage` example
   above) — never paste the raw key into the YAML file itself.

**To run/test the action locally on your machine** (for the manual
`quickstart.md` validation): don't put it in any file that gets committed.
Either export it for the one command you're running:

```bash
AI_GATEWAY_API_KEY=your-key-here GITHUB_TOKEN=your-token-here node dist/index.js
```

or put it in a local `.env` file (already covered by `.gitignore` in this
repo) and load it with a tool like `dotenv-cli` before running the command.

## Development

```bash
npm install
npm run build          # ncc build -> dist/index.js (committed, see below)
npm test                # unit tests (Vitest)
npm run test:fixtures   # fixture-based pipeline tests
```

See [`specs/001-jev-pr-triage/quickstart.md`](specs/001-jev-pr-triage/quickstart.md)
for the full validation guide, including manual end-to-end runs against real
Jev/Gemini calls.

`dist/` is committed intentionally (not gitignored): GitHub Actions using
`runs.using: node20` need the bundled `dist/index.js` present so consumers of
this action don't need a build step.

### Known implementation notes

- Uses the GitHub **Statuses API** (`repos.createCommitStatus`) rather than
  the Checks API for the PR status indicator — it needs less workflow
  permission (`statuses: write` vs. `checks: write`) for the same
  maintainer-visible outcome.
- The exact shape of Vercel AI SDK 7's `experimental_evaluate` was verified
  against the installed `ai` package (see `src/jev.ts` and
  `specs/001-jev-pr-triage/research.md`) since it's a very recently released,
  experimental API.
- The secondary/fallback review model is **not** hardcoded to any vendor. By
  default (`fallback-review-model` empty), `src/fallback-review.ts` calls
  `gateway.getAvailableModels()` and picks the cheapest priced language
  model on your account at call time; set `fallback-review-model` (or the
  repo config's `fallback_review_model`) to pin a specific model instead.

## Measured cost/latency (SC-005)

_To be filled in after running the manual validation in `quickstart.md`
against a real Vercel AI Gateway key:_

| Scenario | Jev latency | Jev cost (tokens) | Fallback review latency | Fallback cost (tokens) |
|---|---|---|---|---|
| Trivial (docs-only) PR | _TBD_ | _TBD_ | n/a | n/a |
| High-risk PR (human-review) | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

Compare against a full-LLM-per-PR baseline once these numbers are collected.
