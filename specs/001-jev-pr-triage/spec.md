# Feature Specification: Jev PR Triage Gatekeeper

**Feature Branch**: `001-jev-pr-triage`

**Created**: 2026-09-19

**Status**: Draft

**Input**: User description: "Napraviti GitHub Action koji se okida na pull_request evente (opened, synchronize, reopened) i automatski trijažira PR pre review-a. Action treba da: povuče diff, izmenjene fajlove i commit poruke preko GitHub API-ja; postavi PR-u tipizirana pitanja: da li uopšte zaslužuje review (da/ne), koliko je rizičan (skala), gde da se ruta (auto-approve / human-review / block), i da li sadrži nešto što liči na kredencijale (da/ne); na osnovu odgovora postavi odgovarajući GitHub status check; ostavi komentar na PR-u sa jasnim obrazloženjem odluke; loguje cenu i vreme trajanja svake odluke radi kasnijeg poređenja. Uključuje i sekundarni, detaljniji review od skupljeg modela za PR-ove rutirane na human-review sa visokim rizikom, pre nego što se komentar objavi."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trivial PRs pass without waiting (Priority: P1)

As a repository maintainer, when a contributor opens a PR that only touches docs,
fixes a typo, or changes generated files, I want it approved automatically so
nobody waits on a review that adds no value.

**Why this priority**: This is the core time-saving promise of the feature and
the easiest to demonstrate and measure.

**Independent Test**: Open a PR that changes only a `README.md` typo; verify the
status check turns green and no human review is requested, within seconds of the
PR being opened.

**Acceptance Scenarios**:

1. **Given** a PR that only modifies documentation files, **When** the PR is
   opened, **Then** the status check reports success and the PR comment states
   the PR was auto-approved because it was judged low-risk/no-review-needed.
2. **Given** a PR that only fixes a typo in a code comment, **When** the PR is
   synchronized with a new commit, **Then** the triage re-runs and again reports
   auto-approve.

---

### User Story 2 - Risky PRs are automatically flagged and blocked (Priority: P1)

As a repository maintainer, when a PR touches sensitive areas (authentication,
database migrations, CI/CD configuration), I want it automatically marked
high-risk and blocked until a human explicitly approves it, so nothing sensitive
slips through unnoticed.

**Why this priority**: This is the safety-critical counterpart to Story 1 — the
feature only earns trust if it never lets risky changes through silently.

**Independent Test**: Open a PR that modifies an authentication module or a CI
workflow file; verify the status check reports a blocking/pending state that
requires human action.

**Acceptance Scenarios**:

1. **Given** a PR that modifies a database migration file, **When** the PR is
   opened, **Then** the status check does not report success and the PR comment
   explains the PR was judged high-risk.
2. **Given** a PR that modifies both a trivial doc file and a CI/CD config file
   in the same diff, **When** the PR is opened, **Then** the PR is treated
   according to its highest-risk change (blocked/flagged), not averaged down.

---

### User Story 3 - Every decision comes with a visible reason (Priority: P2)

As a repository maintainer, I want to see exactly why a PR was routed the way it
was, directly on the PR, so I can trust and audit the automated decision without
reading the tool's internals.

**Why this priority**: Explainability is what makes maintainers comfortable
delegating a real decision to an automated tool.

**Independent Test**: Open any PR and confirm a comment appears stating the
triage answers received and the resulting routing decision and rationale.

**Acceptance Scenarios**:

1. **Given** any PR that triggers triage, **When** the routing decision is made,
   **Then** a PR comment is posted naming the routing outcome and the reasoning
   behind it.
2. **Given** a PR where the diff appears to contain a credential-like string,
   **When** the comment is posted, **Then** the comment mentions that a possible
   secret was detected without quoting the diff content itself.

---

### User Story 4 - Expensive review only happens when truly needed (Priority: P2)

As a repository maintainer, I want a more expensive, detailed review to run only
for PRs that the fast triage step routes to human review with elevated risk, not
for every PR, so the team only pays for deep review where it adds value.

**Why this priority**: This is the secondary economic promise of the feature —
the expensive step is opt-in-by-risk, not blanket.

**Independent Test**: Compare two PRs — a trivial one and a high-risk
human-review one — and confirm the detailed review step only executes for the
latter.

**Acceptance Scenarios**:

1. **Given** a PR routed to `auto-approve`, **When** triage completes, **Then**
   no detailed secondary review is performed.
2. **Given** a PR routed to `human-review` with elevated risk, **When** triage
   completes, **Then** a detailed secondary review runs and its findings are
   included in the PR comment before the human reviews it.
3. **Given** a PR routed to `human-review` where the detailed secondary review
   fails or is unavailable, **When** the comment is posted, **Then** the comment
   still reports the triage outcome and states the detailed review could not be
   completed.

---

### User Story 5 - Risk sensitivity is configurable without code changes (Priority: P3)

As a repository maintainer, I want to adjust what counts as "risky" for my
repository without modifying the tool's code, so different teams can tune
sensitivity to their own risk tolerance.

**Why this priority**: Important for adoption across different repositories, but
the feature delivers value with sane defaults even before anyone customizes it.

**Independent Test**: Change a risk-threshold setting in the repository
configuration and confirm a previously auto-approved class of PR now routes to
human-review, without any code/tool changes.

**Acceptance Scenarios**:

1. **Given** a maintainer edits the repository's risk configuration to be
   stricter, **When** the next PR is triaged, **Then** the new threshold is
   respected without redeploying the tool.
2. **Given** no configuration is present, **When** a PR is triaged, **Then** the
   built-in conservative defaults apply.

---

### Edge Cases

- What happens when the fast triage step itself fails or times out? The PR MUST
  be routed to human-review (safe default), never silently auto-approved.
- What happens when the triage step's two signals disagree (e.g., it says the PR
  doesn't need review, but also says the route is human-review)? The routing
  decision is authoritative and is what controls the outcome; the disagreement
  itself is not treated as a failure.
- What happens when a single PR mixes trivial and sensitive changes (e.g., a
  typo fix and a CI config change together)? The PR is treated at its highest
  detected risk level, not an average.
- What happens when the diff appears to contain a credential or secret? The
  content is never echoed in logs or PR comments; only the fact that something
  suspicious was found is communicated.
- What happens when a PR is updated again after already being triaged (new
  commits pushed)? Triage re-runs on the updated diff and the comment/status
  reflect the latest state, not the original one.
- What happens when the detailed secondary review is triggered but the
  underlying service is unavailable? Triage's own decision still stands and is
  reported; the comment notes the detailed review was unavailable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST trigger triage automatically when a pull request
  is opened, updated with new commits, or reopened.
- **FR-002**: The system MUST gather the PR's diff, changed file list, and
  commit messages before making a routing decision.
- **FR-003**: The system MUST obtain, for every PR, a typed (not free-text)
  assessment covering: whether the PR needs review at all, how risky it is, what
  the resulting route should be (auto-approve / human-review / block), and
  whether it appears to touch secrets/credentials.
- **FR-004**: The system MUST set a GitHub status check reflecting the routing
  decision, such that a maintainer can see at a glance whether the PR is clear,
  pending human attention, or blocked.
- **FR-005**: The system MUST post a PR comment explaining the routing decision
  and the reasoning behind it, without ever revealing secret-like diff content.
- **FR-006**: When a PR is routed to human-review with elevated risk, the system
  MUST trigger a more detailed, secondary review before the explanatory comment
  is posted, and MUST include that review's findings in the comment; if this
  secondary review is unavailable, the system MUST still post the primary
  routing decision and note the detailed review could not be completed.
- **FR-007**: The system MUST record the cost and time taken for every triage
  and secondary-review decision, so cost/time savings can be measured against a
  baseline of full review on every PR.
- **FR-008**: Maintainers MUST be able to adjust risk sensitivity/thresholds for
  their repository without changing the tool's code.
- **FR-009**: When the fast triage step fails or times out, the system MUST
  default to routing the PR to human-review rather than auto-approving or
  leaving no status check.

### Key Entities

- **Pull Request Triage Decision**: The typed outcome of evaluating one PR —
  whether it needs review, its risk level, its route, and whether it appears to
  touch secrets. Tied to a specific PR and commit state.
- **Secondary Review Result**: The detailed findings produced for PRs escalated
  to human-review with elevated risk; tied to a specific Triage Decision.
- **Risk Configuration**: The maintainer-adjustable settings that determine risk
  thresholds and routing sensitivity for a given repository.
- **Decision Log Entry**: A record of cost and latency for a single triage or
  secondary-review call, used for later cost/time comparison reporting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A trivial PR (docs-only or typo-only change) is auto-approved
  within about 2 seconds of being opened, with no human involvement.
- **SC-002**: 100% of PRs touching authentication, database migrations, or
  CI/CD configuration in a test set are flagged high-risk and blocked or routed
  to human-review, never silently auto-approved.
- **SC-003**: Every routed PR has a visible, specific explanation of its
  decision, verifiable by reading the PR comment alone (no access to logs or
  source needed).
- **SC-004**: The detailed secondary review runs only for medium/high-risk PRs
  routed to human-review — measurably less than 100% of all PRs in a mixed test
  set.
- **SC-005**: A report (e.g., in the project's README) shows quantified cost and
  time savings versus a baseline where every PR receives a full detailed review.
- **SC-006**: A maintainer can change risk-threshold behavior by editing
  repository configuration alone, with the new behavior taking effect on the
  next PR with no code change or redeploy.

## Assumptions

- Credentials/access for the typed fast-triage assessment and the detailed
  secondary review are provisioned and available as repository secrets before
  this feature is exercised end-to-end.
- GitHub is the only platform this feature targets; other forges are out of
  scope.
- Trivial PRs (docs-only, typo-only, generated-file-only) are reliably
  identifiable from diff and file-list signals alone, without executing code.
- The majority of PRs in a typical repository are expected to be resolvable by
  the fast triage step alone, with the detailed secondary review needed only for
  a minority of higher-risk cases.
- Inline, line-by-line code comments; non-GitHub platform support; a dashboard
  outside GitHub; training/fine-tuning the fast-triage model; and automatic
  merging are all explicitly out of scope for this feature.
