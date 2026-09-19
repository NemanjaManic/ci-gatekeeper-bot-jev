---

description: "Task list for feature implementation"
---

# Tasks: Jev PR Triage Gatekeeper

**Input**: Design documents from `/specs/001-jev-pr-triage/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the constitution's Development Workflow section and
plan.md's Testing context explicitly require Vitest unit tests and
fixture-based pipeline tests.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P3) to
enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

## Path Conventions

Single project, per `plan.md` → Project Structure: `action.yml`, `src/`,
`tests/unit/`, `tests/fixtures/` at repository root.

---

## Phase 1: Setup

**Purpose**: Project initialization and basic structure

- [X] T001 Create the directory skeleton per `plan.md` → Project Structure:
      `src/`, `tests/unit/`, `tests/fixtures/` at the repository root.
- [X] T002 Initialize the npm package: `package.json` (name
      `ci-gatekeeper-bot-jev`, Node 20 engine) and `tsconfig.json` (TypeScript,
      CommonJS or ESM target compatible with `@vercel/ncc`). Add dependencies
      `ai`, `@actions/core`, `@actions/github`; dev dependencies `typescript`,
      `@vercel/ncc`, `vitest`, `@types/node`.
- [X] T003 [P] Add npm scripts to `package.json`: `build` (`ncc build
      src/index.ts -o dist`), `test` (`vitest run tests/unit`), `test:fixtures`
      (`vitest run tests/fixtures`), matching the commands documented in
      `quickstart.md`.
- [X] T004 [P] Create `action.yml` at the repository root with the inputs,
      outputs, and `runs.using: node20` / `main: dist/index.js` declaration
      specified in `contracts/action-interface.md` (inputs:
      `github-token`, `ai-gateway-api-key`, `risk-threshold-for-review`
      default `"cosmetic"`, `risk-threshold-for-block` default `"blocking"`,
      `fallback-review-risk-threshold` default `"blocking"`, `config-path`
      default `.github/jev-gatekeeper.yml`; outputs: `route`, `risk`,
      `touches_secrets`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story depends on — a minimal
end-to-end pipeline skeleton, with story-specific behavior layered on top in
Phase 3+.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Define shared TypeScript types in `src/types.ts` for
      `PullRequestTriageDecision`, `RiskConfiguration`, `DecisionLogEntry`, and
      `SecondaryReviewResult` exactly as fielded in `data-model.md` (including
      `jev_recommended_route: Route | null`, `escalated: boolean`, and
      `source: "jev" | "fallback-default"` on `PullRequestTriageDecision`).
- [X] T006 [P] Implement `src/github.ts` read functions: fetch the PR diff,
      changed-file list, and commit messages via `@actions/github` /
      `@actions/core` (FR-002), matching `JevTriageInput` in
      `contracts/jev-schema.md`.
- [X] T007 [P] Implement `src/github.ts` write functions: `postOrUpdateComment(body: string)`
      (find an existing comment containing the `<!-- jev-gatekeeper -->` marker
      from `contracts/pr-comment-format.md` and edit it in place rather than
      creating a duplicate — per the spec's edge case "PR updated after
      triage") and `setStatusCheck(conclusion: "success" | "pending" | "failure")`
      per the Status Check Mapping table in `contracts/action-interface.md`.
- [X] T008 [P] Implement `src/metrics.ts`: a `recordDecisionLogEntry` function
      matching the `DecisionLogEntry` shape in `data-model.md`
      (`call_type`, `pull_request_number`, `input_tokens`, `output_tokens`,
      `latency_ms`, `status`). Constraint from `data-model.md`: entries "MUST
      NOT include diff content or any field from the PR body/diff — only
      numeric usage/latency and the PR number for correlation."
- [X] T009 Implement `src/config.ts`: load `RiskConfiguration` with precedence
      `.github/jev-gatekeeper.yml` (path from the `config-path` input) >
      `action.yml` inputs > built-in defaults (`risk_threshold_for_review:
      "cosmetic"`, `risk_threshold_for_block: "blocking"`,
      `fallback_review_risk_threshold: "blocking"`, `sensitive_path_patterns:
      []`), per `research.md` → "Configuration precedence" and the
      `data-model.md` constraint: "Built-in default MUST be conservative...
      never a looser default" and "Loaded fresh on every action run; no
      caching across runs."
- [X] T010 Implement `src/jev.ts` base call: invoke Jev via
      `experimental_evaluate` with the `JevTriageInput` from T006, parse the
      `JevTriageResponse` from `contracts/jev-schema.md`, and forward `usage`
      to `recordDecisionLogEntry` (`call_type: "jev-triage"`) via T008.
      Depends on: T005, T006, T008.
- [X] T011 Implement `src/jev.ts` failure fallback: on call failure/timeout,
      synthesize a `PullRequestTriageDecision` with `route: "human-review"`,
      `jev_recommended_route: null`, `escalated: false`,
      `source: "fallback-default"` instead of throwing (Constitution VI,
      FR-009; `contracts/jev-schema.md` rule 3). Depends on: T010.
- [X] T012 Implement `src/index.ts` orchestration skeleton: read the event via
      `@actions/github` context, call T006/T009/T010–T011 in sequence, call
      `setStatusCheck` (T007) using the raw `route` from T010/T011 (escalation
      logic added in US2), and call `postOrUpdateComment` (T007) with a
      minimal placeholder body. Depends on: T006, T007, T009, T010, T011.

**Checkpoint**: A PR event now produces *some* status check and comment
end-to-end. Story phases below add the specific behavior each user story
requires.

---

## Phase 3: User Story 1 - Trivial PRs pass without waiting (Priority: P1) 🎯 MVP

**Goal**: A PR that only touches docs/typos/generated files is auto-approved
within ~2 seconds, no human involvement (SC-001).

**Independent Test**: Run the pipeline against a docs-only fixture diff and
confirm the status check reports `success` with no secondary review computed.

### Tests for User Story 1

- [X] T013 [P] [US1] Create fixture `tests/fixtures/trivial-docs.diff` (a
      README-only change) and its mocked `JevTriageResponse`
      (`should_review: false, risk: "cosmetic", route: "auto-approve",
      touches_secrets: false`) in `tests/fixtures/pipeline.test.ts`.
- [X] T014 [P] [US1] Write the fixture pipeline test in
      `tests/fixtures/pipeline.test.ts` asserting: status check conclusion is
      `success`, no `SecondaryReviewResult` is computed, per `quickstart.md`
      fixture scenario 1. This test MUST fail before T015–T016 are wired.

### Implementation for User Story 1

- [X] T015 [US1] In `src/index.ts`, confirm/complete the `route ==
      "auto-approve"` → `setStatusCheck("success")` path from T012 (no
      escalation applies when Jev already recommends `auto-approve` and no
      config threshold triggers — this path should already work from
      Foundational; this task is the explicit verification + any missing
      wiring). Depends on: T012.
- [X] T016 [US1] Run T014 and confirm it passes; fix any gap between T012's
      skeleton and the expected fixture outcome.

**Checkpoint**: User Story 1 is independently functional — trivial PRs
auto-approve end-to-end.

---

## Phase 4: User Story 2 - Risky PRs are automatically flagged and blocked (Priority: P1)

**Goal**: PRs touching auth/migrations/CI-config are escalated to
`human-review` or `block` and never silently pass (SC-002).

**Independent Test**: Run the pipeline against an auth-touching fixture and a
CI-config-touching fixture; confirm neither reports `success`.

### Tests for User Story 2

- [X] T017 [P] [US2] Create fixture `tests/fixtures/auth-change.diff` (modifies
      an authentication module) with a mocked `JevTriageResponse` of
      `risk: "blocking"`.
- [X] T018 [P] [US2] Create fixture `tests/fixtures/ci-config-change.diff`
      (modifies a `.github/workflows/*.yml` file) with a mocked
      `JevTriageResponse` of `risk: "moderate"` but a changed-file path that
      matches a configured `sensitive_path_patterns` entry.
- [X] T019 [P] [US2] Create fixture `tests/fixtures/mixed-trivial-and-ci.diff`
      combining a doc change and a CI-config change in one diff.
- [X] T020 [US2] Write fixture pipeline tests in
      `tests/fixtures/pipeline.test.ts` asserting: (a) the auth-change fixture
      (T017) does not resolve to `success`; (b) the CI-config fixture (T018)
      is `escalated: true` with `route: "block"` even though Jev's own
      `risk` was only `"moderate"`, because it matched
      `sensitive_path_patterns`; (c) the mixed fixture (T019) resolves to the
      **maximum** risk across changed files, per `data-model.md`'s validation
      rule "the PR's overall risk is the maximum risk across all changed-file
      signals," not an average. These tests MUST fail before T021–T022 are
      implemented.

### Implementation for User Story 2

- [X] T021 [US2] Implement risk-to-route escalation in `src/jev.ts`: combine
      `jev_recommended_route` with `RiskConfiguration.risk_threshold_for_block`
      and `sensitive_path_patterns` (loaded via T009) to compute the
      *effective* `route`, per `contracts/jev-schema.md` mapping rule 1.
      Constraint (data-model.md): "`route` MUST NOT be a looser outcome than
      `jev_recommended_route`... escalation only ever tightens the decision,
      never loosens it." Set `escalated: true` whenever `route !=
      jev_recommended_route`. Depends on: T009, T010, T011.
- [X] T022 [US2] Implement "maximum risk across changed files" resolution: if
      any changed file matches `sensitive_path_patterns`, treat that as at
      least `risk: "blocking"` for escalation purposes regardless of Jev's own
      `risk` score, per the Edge Case in `spec.md` ("mixed trivial and
      sensitive diff... treated at its highest detected risk level, not an
      average"). Depends on: T021.
- [X] T023 [US2] Wire `src/index.ts` to use the escalated route (T021) instead
      of the raw Jev route for `setStatusCheck` (superseding the T015 minimal
      path for non-auto-approve outcomes).

**Checkpoint**: User Stories 1 AND 2 both work independently — trivial PRs
pass, risky PRs never silently do.

---

## Phase 5: User Story 3 - Every decision comes with a visible reason (Priority: P2)

**Goal**: Every PR gets a PR comment naming the routing outcome and reasoning,
without ever exposing secret-like diff content (SC-003).

**Independent Test**: Trigger triage on any fixture and confirm a comment is
posted matching `contracts/pr-comment-format.md`.

### Tests for User Story 3

- [X] T024 [P] [US3] Create fixture `tests/fixtures/secret-looking-diff.diff`
      with a mocked `JevTriageResponse` of `touches_secrets: true`.
- [X] T025 [US3] Write fixture pipeline tests in
      `tests/fixtures/pipeline.test.ts` asserting: (a) every fixture from US1
      and US2 produces a comment containing the `<!-- jev-gatekeeper -->`
      marker, the route, and a plain-language reason; (b) the T024 fixture's
      comment mentions a possible secret was detected and contains **no**
      substring of the fixture's diff content (Constitution IV); (c) the
      T018/T019 escalated fixtures' comments state the escalation explicitly
      per `contracts/pr-comment-format.md`'s `escalated == true` block. These
      tests MUST fail before T026–T027 are implemented.

### Implementation for User Story 3

- [X] T026 [US3] Implement the comment body builder in `src/github.ts` (or a
      new `src/comment.ts`) following the exact structure in
      `contracts/pr-comment-format.md`: route, risk, `should_review` (labeled
      as signal-only), plain-language reason, conditional escalation block,
      conditional secrets-warning block (no diff content), conditional
      fallback-default block, conditional secondary-review block, and the
      cost/latency footer sourced from `DecisionLogEntry` (T008).
- [X] T027 [US3] Wire `src/index.ts` to call the T026 builder with the full
      `PullRequestTriageDecision` (post-escalation from T021–T023) and pass
      the result to `postOrUpdateComment` (T007), replacing the placeholder
      body from T012.

**Checkpoint**: All triaged PRs now carry a visible, accurate rationale.

---

## Phase 6: User Story 4 - Expensive review only happens when truly needed (Priority: P2)

**Goal**: The Gemini secondary review (FR-006) runs only for `route ==
"human-review"` PRs at/above `fallback_review_risk_threshold`, never for
`auto-approve` (SC-004).

**Independent Test**: Compare a `human-review`+high-risk fixture against an
`auto-approve` fixture and confirm the secondary review only runs for the
former.

### Tests for User Story 4

- [X] T028 [P] [US4] Extend the T017 (auth-change) fixture scenario with a
      mocked Gemini response, asserting in
      `tests/fixtures/pipeline.test.ts` that a `SecondaryReviewResult` with
      `status: "completed"` is produced and its `findings` appear in the
      posted comment.
- [X] T029 [P] [US4] Add a fixture asserting that the T013 (trivial,
      auto-approve) fixture produces **no** `SecondaryReviewResult` at all
      (not even an "unavailable" one) — per FR-006/US4 Acceptance Scenario 1.
- [X] T030 [P] [US4] Add a fixture with a mocked Gemini call failure for a
      `human-review`+high-risk PR, asserting the comment still reports the
      primary routing decision and states the detailed review could not be
      completed (`SecondaryReviewResult.status == "unavailable"`), per FR-006
      Acceptance Scenario 3. These tests (T028–T030) MUST fail before
      T031–T033 are implemented.

### Implementation for User Story 4

- [X] T031 [US4] Implement `src/fallback-review.ts`: call a Gemini model via
      the same Vercel AI Gateway (`AI_GATEWAY_API_KEY`) with the PR diff/files
      for PRs meeting the escalation gate in T032, returning a
      `SecondaryReviewResult`. On failure, return
      `{ status: "unavailable", findings: null }` instead of throwing
      (Constitution VI / FR-006 Acceptance Scenario 3). Forward usage/latency
      to `recordDecisionLogEntry` (T008) with `call_type: "fallback-review"`.
- [X] T032 [US4] Wire `src/index.ts` to call `src/fallback-review.ts` (T031)
      **only when** the effective `route == "human-review"` (from T021–T023)
      **and** `risk` is at/above `RiskConfiguration.fallback_review_risk_threshold`
      (T009) — per Constitution II ("Escalate Only When Necessary") and
      `data-model.md`'s validation rule: "Never computed for decisions with
      `route != "human-review"` or `risk` below the fallback threshold."
- [X] T033 [US4] Extend the T026 comment builder call site (T027) to include
      the `SecondaryReviewResult` findings block (completed) or the
      unavailable-notice block, per `contracts/pr-comment-format.md`.

**Checkpoint**: The expensive review path is now opt-in-by-risk, matching
the project's core cost-saving premise.

---

## Phase 7: User Story 5 - Risk sensitivity is configurable without code changes (Priority: P3)

**Goal**: A maintainer can change risk thresholds via
`.github/jev-gatekeeper.yml` or `action.yml` inputs and see routing behavior
change on the next PR, with no code change or redeploy (SC-006).

**Independent Test**: Run the same fixture PR twice — once with built-in
defaults, once with a stricter repo config — and confirm the routing outcome
changes.

### Tests for User Story 5

- [X] T034 [P] [US5] Write a unit test in `tests/unit/config.test.ts`
      asserting the precedence order from T009: a value present in a mocked
      `.github/jev-gatekeeper.yml` wins over an `action.yml` input, which
      wins over the built-in default.
- [X] T035 [US5] Write a fixture pipeline test in
      `tests/fixtures/pipeline.test.ts` reusing a moderate-risk fixture:
      assert it routes to `auto-approve` under the built-in default
      (`risk_threshold_for_review: "cosmetic"` still allows `human-review`
      only above cosmetic — adjust fixture risk accordingly) and to
      `human-review` once a stricter `risk_threshold_for_review` is supplied
      via mocked repo config, with no code path change. This test MUST fail
      before T036 is implemented if a gap exists.

### Implementation for User Story 5

- [X] T036 [US5] Verify/complete `src/config.ts` (T009) reads
      `risk_threshold_for_review` from repo config and actually gates the
      auto-approve decision in `src/jev.ts` (T021) — not just
      `risk_threshold_for_block` — closing any gap between "risk score" and
      "auto-approve vs. human-review" for non-sensitive-path PRs.

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T037 [P] Write unit tests in `tests/unit/jev-mapping.test.ts` for the
      route escalation logic (T021–T022) in isolation (no GitHub/Jev network
      calls), covering: no escalation needed, threshold-triggered escalation,
      sensitive-path-triggered escalation, and the failure-fallback path
      (T011).
- [X] T038 [P] Write a unit test in `tests/unit/secret-redaction.test.ts`
      confirming the comment builder (T026) never includes diff content when
      `touches_secrets == true`, and confirming `recordDecisionLogEntry` (T008)
      never receives diff content as an argument.
- [X] T039 Add a top-level `README.md` documenting the action's inputs/outputs
      (from `contracts/action-interface.md`), and a placeholder section for
      the measured cost/latency numbers (SC-005), to be filled in after
      running the manual validation in `quickstart.md`.
- [X] T040 Run the full `quickstart.md` validation end-to-end (build, `npm
      test`, `npm run test:fixtures`, and the manual real-Jev/fallback-review
      run), and record the resulting cost/latency numbers into `README.md`
      (T039). **Done**: validated via real PRs against the action's own repo
      (`.github/workflows/jev-gatekeeper.yml`, PRs #1, #2, #5, #6) covering
      trivial auto-approve, Jev-native block (CI permissions), the fallback
      review triggering for real (auto-picked `inclusionai/ling-3.0-flash-fin`
      at call time), `touches_secrets` detection/redaction, config-driven
      `sensitive_path_patterns` override (US5), and mixed-diff highest-risk-
      wins. Measured numbers recorded in `README.md`'s "Measured cost/latency"
      table.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational only (independently
  testable from US1, though both touch `src/jev.ts`/`src/index.ts` — see
  Parallel Opportunities note below).
- **User Story 3 (Phase 5)**: Depends on Foundational; consumes the `route`/
  `escalated` fields US2 populates, so US2 should land first even though the
  comment *builder itself* (T026) can be written in parallel.
- **User Story 4 (Phase 6)**: Depends on Foundational and on US2's escalated
  `route` (the escalation gate in T032 checks the effective route).
- **User Story 5 (Phase 7)**: Depends on Foundational (`src/config.ts`, T009)
  and on US2's use of config in T021.
- **Polish (Phase 8)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests are written first and MUST fail before the corresponding
  implementation tasks.
- Fixtures before pipeline test assertions.
- `src/jev.ts` escalation logic before `src/index.ts` wiring that consumes it.

### Parallel Opportunities

- All Setup tasks marked [P] (T003, T004) can run in parallel once T001–T002
  land.
- Foundational tasks T005, T006, T007, T008 are marked [P] (different files);
  T009–T012 are sequential (each depends on the previous).
- Fixture-creation tasks within a story (e.g., T017/T018/T019, or T028/T029/T030)
  are marked [P] since each is a new, independent fixture file.
- US1 and US2 touch overlapping files (`src/jev.ts`, `src/index.ts`) — treat
  them as sequential (US1 → US2) rather than parallel, even though they are
  logically independent stories, to avoid merge conflicts in those two files.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: trivial-PR fixture test (T014) passes.
5. This is the smallest deployable/demoable slice (auto-approve works; risky
   PRs are not yet specially handled beyond Jev's own raw recommendation).

### Incremental Delivery

1. Setup + Foundational → skeleton pipeline runs end-to-end.
2. + User Story 1 → trivial PRs auto-approve (MVP).
3. + User Story 2 → risky PRs never silently pass (safety-critical; do this
   next, both are P1).
4. + User Story 3 → every decision is explained on the PR.
5. + User Story 4 → expensive review is opt-in-by-risk.
6. + User Story 5 → thresholds are maintainer-configurable.
7. Polish → tests, README with measured numbers.
