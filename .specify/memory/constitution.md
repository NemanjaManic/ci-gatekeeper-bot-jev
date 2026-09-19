<!--
Sync Impact Report
Version change: none → 1.0.0 (initial ratification)
Modified principles: n/a (new document)
Added sections: Core Principles (I-VII), Technical Constraints, Development Workflow, Governance
Removed sections: n/a
Follow-up TODOs: none
-->

# CI Gatekeeper Bot (Jev) Constitution

## Core Principles

### I. Cheap-First Triage
Every routing decision starts with Jev (TypeSafe AI), a cheap, fast, typed decision
model that returns boolean/score/choice answers, never free text. Jev MUST be used
for any decision it can make reliably. A more expensive LLM or a human reviewer is
never the first thing consulted.

### II. Escalate Only When Necessary
The expensive fallback LLM review (FR-006) and human review are invoked only when
Jev's `route` decision actually requires them (`human-review` above the configured
risk threshold). Calling the expensive path for PRs Jev can already resolve
defeats the purpose of the project and MUST NOT happen.

### III. Explainability
Every routing decision MUST be explained directly on the PR as a comment: which
question was asked, what Jev answered, and why that produced the given route. A
routing decision with no visible rationale is not acceptable, since maintainers
must be able to trust and audit the bot without reading its source.

### IV. Secret Safety (NON-NEGOTIABLE)
API keys, gateway credentials, and any diff content that looks like a leaked
credential (`touches_secrets == true`) MUST NEVER be logged or echoed into a PR
comment. When `touches_secrets` is true, the comment states that a possible
secret was detected without quoting the offending content.

### V. Route Is Truth
`route` (`auto-approve` / `human-review` / `block`) is the single source of truth
for the GitHub status check. `should_review` is explanatory context for the PR
comment only and MUST NOT influence control flow. An apparent contradiction
between `should_review` and `route` is not an error condition and MUST NOT block
the pipeline.

### VI. Safe Default on Failure
If a Jev call fails or times out, the action MUST fall back to `route: human-review`
rather than silently auto-approving or crashing without a status check. A GitHub
API failure (comment or status check) MUST fail the action loudly (non-zero exit)
rather than fail silently.

### VII. GitHub-Only Scope (v1)
GitHub is the only target platform in v1. GitLab, Bitbucket, Azure DevOps, and any
non-GitHub surface are explicitly out of scope until a future major version.

## Technical Constraints

- Packaging: JavaScript/TypeScript GitHub Action (Node.js 20+, `runs.using: node20`),
  TypeScript compiled and bundled into `dist/index.js` via `@vercel/ncc`. Composite
  and Docker action types are rejected for v1 (see brainstorming decision log) to
  keep cold-start latency compatible with the "~2 seconds for trivial PRs" success
  criterion.
- AI layer: Vercel AI SDK 7 (`ai` package), `experimental_evaluate` API, model
  `typesafe-ai/jev` via Vercel AI Gateway (`AI_GATEWAY_API_KEY` secret).
- Secondary/fallback review (FR-006) is in v1 scope: when `route == human-review`
  and `risk` is above the configured fallback threshold, a Gemini model via the
  same Vercel AI Gateway performs a detailed review before the PR comment is
  posted. If the fallback call fails, the pipeline proceeds with Jev's decision
  alone and states in the comment that the detailed review was unavailable.
- Default risk thresholds ship conservative: uncertain or moderate-risk cases
  default to `human-review`, not `auto-approve`, until a maintainer explicitly
  configures looser thresholds.
- Configuration precedence: `.github/jev-gatekeeper.yml` (repo config) overrides
  `action.yml` inputs, which override built-in conservative defaults.
- Package manager: npm (this project does not depend on pnpm/yarn tooling).

## Development Workflow

- Spec Kit governs the project lifecycle: `constitution → specify → plan → tasks →
  implement`. Each phase's output is reviewed by the maintainer before the next
  phase starts.
- Unit tests (Vitest) cover the Jev-response-to-routing mapping, config precedence
  resolution, and secret-redaction logic. Fixture-based integration tests cover
  full pipeline runs (trivial PR, high-risk PR) against mocked GitHub/Jev/Gemini
  calls.
- Every Jev and fallback-LLM call logs cost (input/output tokens) and latency
  (FR-007), so routing decisions remain measurable against a full-LLM-review
  baseline.
- Personal planning/notes documents (e.g. the source Spec Kit planning doc) stay
  local and gitignored; only generated project artifacts (code, Spec Kit
  constitution/spec/plan/tasks documents, tests, config) are pushed to the public
  repository.

## Governance

This constitution supersedes ad hoc technical decisions for this project.
Amendments require: a documented rationale, a version bump per semantic
versioning (MAJOR for incompatible principle removal/redefinition, MINOR for a
new principle or materially expanded guidance, PATCH for wording/clarification),
and an updated `Last Amended` date below. Every Spec Kit phase transition
(`specify` → `plan` → `tasks` → `implement`) MUST be checked against these
principles before proceeding; a violation must be justified in the relevant
spec/plan document or the design must change.

**Version**: 1.0.0 | **Ratified**: 2026-09-19 | **Last Amended**: 2026-09-19
