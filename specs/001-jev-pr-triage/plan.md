# Implementation Plan: Jev PR Triage Gatekeeper

**Branch**: `001-jev-pr-triage` | **Date**: 2026-09-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-jev-pr-triage/spec.md`

## Summary

Build a GitHub Action that triggers on `pull_request` events, gathers the diff/
changed files/commit messages, asks Jev (a cheap, fast, typed decision model via
Vercel AI Gateway) four typed questions (`should_review`, `risk`, `route`,
`touches_secrets`), sets a GitHub status check and posts an explanatory PR
comment based on the `route` answer, and — only when `route == human-review`
with elevated risk — runs a secondary, more detailed review via Gemini (same
Gateway) before posting. Every Jev/Gemini call logs cost and latency for later
comparison against a full-LLM-per-PR baseline.

## Technical Context

**Language/Version**: TypeScript, Node.js 20+

**Primary Dependencies**: `ai` (Vercel AI SDK 7, `experimental_evaluate` API),
`@actions/core`, `@actions/github`, `@vercel/ncc` (build-time bundler only)

**Storage**: N/A — stateless action; per-repo risk configuration is read from
`.github/jev-gatekeeper.yml` at runtime, no persistence owned by the action
itself

**Testing**: Vitest (unit tests for response-to-routing mapping, config
precedence, secret redaction; fixture-based tests for full pipeline runs against
mocked GitHub/Jev/Gemini calls)

**Target Platform**: GitHub Actions runner (`runs.using: node20`)

**Project Type**: Single project — a JavaScript/TypeScript GitHub Action

**Performance Goals**: Trivial PR triage (Jev call + status check + comment)
completes in ~2 seconds end-to-end (SC-001)

**Constraints**: Diff content MUST NOT be logged or echoed in comments when
`touches_secrets == true` (Constitution IV); a failed/timed-out Jev call MUST
default to `route: human-review`, never silent auto-approve (Constitution VI);
config changes MUST take effect without redeploying the action (SC-006)

**Scale/Scope**: Single action invocation per PR event; expected load is one
PR's diff per run, not batch processing

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Cheap-First Triage | Jev is the first and only call for every PR unless escalation criteria are met | PASS — `src/jev.ts` is the sole entry point for the fast path |
| II. Escalate Only When Necessary | Secondary Gemini review only runs for `route == human-review` + risk above threshold | PASS — gated in `src/index.ts` orchestration, see `data-model.md` |
| III. Explainability | Every routed PR gets a PR comment naming the answers and reasoning | PASS — `src/github.ts` comment builder, see `contracts/pr-comment-format.md` |
| IV. Secret Safety (NON-NEGOTIABLE) | `touches_secrets` never causes diff content to be logged/commented | PASS — redaction rule enforced in comment builder and logger, see `data-model.md` |
| V. Route Is Truth | `route` alone drives the status check; `should_review` is comment-only | PASS — mapping isolated in `src/jev.ts`, see `contracts/jev-schema.md` |
| VI. Safe Default on Failure | Jev failure → `human-review`; GitHub API failure → loud non-zero exit | PASS — error handling documented in `research.md` |
| VII. GitHub-Only Scope (v1) | No non-GitHub integration code | PASS — `src/github.ts` is the only external-platform module |

No violations identified. Complexity Tracking table is omitted (nothing to justify).

## Project Structure

### Documentation (this feature)

```text
specs/001-jev-pr-triage/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── jev-schema.md
│   ├── action-interface.md
│   └── pr-comment-format.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
action.yml                     # Action definition: inputs, outputs, runs.using: node20
src/
├── index.ts                   # Entry point / orchestration
├── jev.ts                     # Jev call + typed-response-to-routing mapping
├── fallback-review.ts         # Secondary Gemini review (FR-006), only for human-review+high-risk
├── github.ts                  # GitHub API: diff/files/commits fetch, PR comment, status check
├── metrics.ts                 # Cost/latency logging for every Jev and Gemini call
└── config.ts                  # Risk-threshold config loading + precedence resolution

tests/
├── unit/                      # jev.ts mapping, config precedence, secret redaction
└── fixtures/                  # Sample PR diffs (trivial, auth-touching, CI-config-touching, mixed)
    └── pipeline.test.ts       # Full pipeline runs against mocked GitHub/Jev/Gemini

dist/                          # ncc-bundled output; committed to the repo so consumers of the
                                # action don't need a build step
```

**Structure Decision**: Single project (this is one GitHub Action, not a
multi-app repo). Matches the constitution's Technical Constraints section and
the JS/TS + `ncc` packaging decision made during brainstorming.
