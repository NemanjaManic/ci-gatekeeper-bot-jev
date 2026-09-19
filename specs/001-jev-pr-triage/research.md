# Phase 0 Research: Jev PR Triage Gatekeeper

No `NEEDS CLARIFICATION` markers remained in the Technical Context — all
technical decisions below were already resolved during the brainstorming/
constitution phase. This document records the decision, rationale, and
alternatives considered for each, for future reference.

## Action packaging: JavaScript/TypeScript Action vs. Composite vs. Docker

- **Decision**: JavaScript/TypeScript Action (`runs.using: node20`), TypeScript
  compiled and bundled via `@vercel/ncc` into a committed `dist/index.js`.
- **Rationale**: Standard pattern for actions with npm dependencies and HTTP
  calls (GitHub API + Vercel AI Gateway); keeps cold-start latency compatible
  with the ~2 second trivial-PR success criterion; straightforward to unit-test
  with Vitest without spinning up an actual runner.
- **Alternatives considered**: Composite action (shell steps) — would still need
  a bundled Node script underneath for the TypeScript modules, so it saves
  little while losing the standard JS-action Marketplace path. Docker action —
  full isolation but pull/build overhead risks the ~2s latency target for
  trivial PRs.

## AI integration: Vercel AI SDK 7 `experimental_evaluate`

- **Decision**: Use the `ai` package's `experimental_evaluate` API against
  `typesafe-ai/jev` via Vercel AI Gateway for the fast triage path, and a
  Gemini model via the same Gateway for the secondary/fallback detailed review.
- **Rationale**: Jev is purpose-built for typed (boolean/score/choice) low-
  latency decisions instead of free-text LLM output, which is exactly what the
  fast triage step needs; routing both the cheap and the expensive call through
  one Gateway keeps auth/config surface small (single `AI_GATEWAY_API_KEY`).
- **Alternatives considered**: Calling a general-purpose LLM directly for the
  fast path (rejected — defeats the cost/latency goal that is the point of this
  project); a separate provider/SDK for the fallback review (rejected for v1 —
  unnecessary extra credential surface when the Gateway already proxies
  multiple providers).

## Fallback/secondary review model: Gemini

- **Decision**: The FR-006 secondary review uses a Gemini model via Vercel AI
  Gateway.
- **Rationale**: Chosen for its free tier, keeping the "expensive path" cheap
  during development/portfolio use.
- **Alternatives considered**: Claude or GPT via the same Gateway — better
  attribution isn't needed here since (per Constitution II) this path is
  invoked rarely, but Gemini was preferred specifically for cost.
- **Open verification item**: Confirm during implementation that Vercel AI
  Gateway actually proxies the intended Gemini model/tier as expected; if not
  available, fall back to the next cheapest available model on the Gateway and
  update this document.

## Package manager: npm

- **Decision**: npm, not pnpm.
- **Rationale**: pnpm is not installed on the primary development machine;
  npm ships with Node and GitHub Actions runners have it preinstalled, which
  simplifies both local development and CI.
- **Alternatives considered**: Installing pnpm — rejected as unnecessary extra
  setup for a single-package repo with no monorepo/workspace needs.

## Test framework: Vitest

- **Decision**: Vitest for unit and fixture-based tests.
- **Rationale**: Lightweight, fast, native ESM/TypeScript support, low
  configuration overhead compared to Jest for a small single-package action.
- **Alternatives considered**: Jest — more ecosystem tooling but heavier
  config for ESM/TS; not needed at this project's scale.

## Configuration precedence

- **Decision**: `.github/jev-gatekeeper.yml` (repo config) overrides
  `action.yml` inputs, which override built-in conservative defaults.
- **Rationale**: Lets a maintainer version-control their risk tolerance
  alongside their code (repo config), while still allowing quick overrides via
  workflow YAML (`action.yml` inputs) without a separate config file, and
  guarantees safe behavior with zero configuration (built-in defaults).
- **Alternatives considered**: `action.yml` inputs only (rejected — SC-006
  requires adjusting thresholds without code/workflow changes, which a repo
  config file satisfies more naturally); environment variables only (rejected —
  less discoverable and no PR-reviewable history of threshold changes).

## Error handling for Jev/GitHub/fallback failures

- **Decision**: Jev call failure/timeout → route defaults to `human-review`.
  GitHub API failure (comment or status check) → action exits non-zero (fails
  loudly). Fallback Gemini review failure → proceed with Jev's own decision,
  note in the comment that detailed review was unavailable.
- **Rationale**: Directly required by Constitution VI (Safe Default on
  Failure) and FR-006/FR-009 in the spec; a silent auto-approve or a silently
  skipped status check would undermine the tool's core trust proposition.
- **Alternatives considered**: Retrying indefinitely on failure — rejected, adds
  latency risk to the ~2s target without a bounded worst case; treating any
  failure as `block` — rejected as overly disruptive for what may be a transient
  Gateway hiccup, `human-review` is the safer proportionate default.
