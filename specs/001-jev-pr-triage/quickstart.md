# Quickstart: Validating the Jev PR Triage Gatekeeper

## Prerequisites

- Node.js 20+, npm
- A Vercel AI Gateway API key with access to `typesafe-ai/jev` and at least
  one priced language model (for the auto-picked fallback review), exported
  as `AI_GATEWAY_API_KEY`
- A GitHub repository (or fork) to run the action against, with a
  `GITHUB_TOKEN` available (Actions provides this automatically in CI)

## Build

```bash
npm install
npm run build     # runs @vercel/ncc to produce dist/index.js
```

## Unit tests

```bash
npm test           # Vitest: jev.ts mapping, config precedence, secret redaction
```

Expected: all tests pass without any network calls (Jev/GitHub/fallback-review calls are
mocked per `tests/unit/`).

## Fixture-based pipeline tests

```bash
npm run test:fixtures
```

Runs the full orchestration (`src/index.ts`) against fixture diffs in
`tests/fixtures/` with mocked GitHub/Jev/fallback-review responses:

1. **Trivial PR fixture** (docs-only diff) → expect `route: auto-approve`,
   status check `success`, no `SecondaryReviewResult` computed.
2. **Auth-touching PR fixture** → expect elevated `risk`, `route` of
   `human-review` or `block`, status check not `success`.
3. **CI-config-touching PR fixture** → same expectation as above.
4. **Mixed trivial + sensitive PR fixture** → expect the PR is treated at its
   highest detected risk (per `data-model.md` validation rule), not averaged.
5. **Jev-failure fixture** (mocked timeout) → expect `route: human-review`,
   `source: fallback-default`, and the comment noting the fast triage step
   failed.

Expected outcome for all fixtures: SC-001 through SC-004 hold (trivial PR
resolved fast with no escalation; sensitive PRs never silently pass; every
outcome has a rendered comment per `contracts/pr-comment-format.md`; secondary
review only invoked for the human-review + elevated-risk fixture).

## Manual end-to-end validation (real Jev/fallback-review calls)

Since a real `AI_GATEWAY_API_KEY` is available for this project:

```bash
AI_GATEWAY_API_KEY=*** GITHUB_TOKEN=*** node dist/index.js
```

against a real PR (e.g. in the `ci-gatekeeper-bot-jev` repo itself, or a small
test repo) to capture real cost/latency numbers for the README (SC-005). Do
not commit the API key; pass it as an environment variable only, and confirm
no diff content or key material appears in the command's stdout/stderr before
sharing any output.

## Config override validation (SC-006)

1. Run the action once with no `.github/jev-gatekeeper.yml` present — confirm
   built-in conservative defaults apply (`data-model.md` → RiskConfiguration).
2. Add a `.github/jev-gatekeeper.yml` that tightens `risk_threshold_for_review`,
   re-run against the same fixture PR, and confirm the routing outcome changes
   accordingly — with no code change or redeploy.
