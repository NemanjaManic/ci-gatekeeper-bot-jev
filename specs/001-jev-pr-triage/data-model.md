# Phase 1 Data Model: Jev PR Triage Gatekeeper

Entities extracted from `spec.md`'s Key Entities section, with fields and
validation rules derived from the functional requirements and constitution.
This action is stateless between invocations — these are in-memory shapes for
a single run, not persisted records (see FR/Constraint: Storage = N/A).

## PullRequestTriageDecision

The typed outcome of evaluating one PR at a given commit SHA.

| Field | Type | Notes |
|---|---|---|
| `pull_request_number` | number | GitHub PR number |
| `head_sha` | string | Commit SHA the decision applies to; re-triage on new commits produces a new decision, not an update to the old one (Edge Case: PR updated after triage) |
| `should_review` | boolean | Explanatory signal only. MUST NOT drive control flow (Constitution V) |
| `risk` | `"cosmetic" \| "moderate" \| "blocking"` | Ordinal; the PR's overall risk is the **maximum** risk across all changed-file signals (Edge Case: mixed trivial + sensitive diff) |
| `jev_recommended_route` | `"auto-approve" \| "human-review" \| "block"` \| null | Jev's raw answer; `null` when `source == "fallback-default"`. Kept for the decision log/comment, not used directly for the status check |
| `route` | `"auto-approve" \| "human-review" \| "block"` | The **effective** route after applying `RiskConfiguration` escalation rules to `jev_recommended_route` (see `contracts/jev-schema.md`). Authoritative — the only field that determines the status check outcome (Constitution V) |
| `escalated` | boolean | `true` when `route` is stricter than `jev_recommended_route` because of a risk threshold or `sensitive_path_patterns` match — surfaced in the PR comment so escalation is never silent (Constitution III) |
| `touches_secrets` | boolean | When `true`, downstream comment/log rendering MUST redact diff content (Constitution IV) |
| `source` | `"jev" \| "fallback-default"` | `"fallback-default"` when Jev failed/timed out and the safe default (`route: human-review`) was substituted (Constitution VI, FR-009) |

**Validation rules**:
- If `source == "fallback-default"`, `route` MUST be `"human-review"`,
  `jev_recommended_route` MUST be `null`, `escalated` MUST be `false`, and the
  PR comment MUST state the fast triage step failed.
- `route` MUST NOT be a looser outcome than `jev_recommended_route`
  (`auto-approve` < `human-review` < `block`) — escalation only ever
  tightens the decision, never loosens it.
- A contradiction between `should_review` and `route` is valid data, not an
  error — no validation rule rejects it (Constitution V, Edge Case).

## SecondaryReviewResult

Detailed findings produced only for `PullRequestTriageDecision`s escalated per
Constitution II (`route == human-review` and `risk` at/above the configured
fallback threshold).

| Field | Type | Notes |
|---|---|---|
| `triage_decision_ref` | `(pull_request_number, head_sha)` | Ties this result to exactly one triage decision |
| `status` | `"completed" \| "unavailable"` | `"unavailable"` when the Gemini call failed (FR-006) |
| `findings` | string \| null | Human-readable detailed review text; `null` when `status == "unavailable"` |
| `model` | string | Identifies which Gemini model/version answered, for the cost/latency log |

**Validation rules**:
- Never computed for decisions with `route != "human-review"` or `risk` below
  the fallback threshold (Constitution II — escalate only when necessary).
- When `status == "unavailable"`, the PR comment builder MUST still render the
  primary `PullRequestTriageDecision` and explicitly note the detailed review
  could not be completed (FR-006).

## RiskConfiguration

The maintainer-adjustable settings that determine risk thresholds and routing
sensitivity for a repository (FR-008, SC-006).

| Field | Type | Notes |
|---|---|---|
| `source` | `"repo-config" \| "action-input" \| "built-in-default"` | Precedence order per `research.md`: repo-config > action-input > built-in-default |
| `risk_threshold_for_review` | `"cosmetic" \| "moderate" \| "blocking"` | Minimum risk level that prevents `auto-approve` |
| `risk_threshold_for_block` | `"moderate" \| "blocking"` | Minimum risk level that forces `block` over `human-review` |
| `fallback_review_risk_threshold` | `"moderate" \| "blocking"` | Minimum risk level (at `route == human-review`) that triggers the secondary review (Constitution II) |
| `fallback_review_model` | string | AI Gateway model id for the secondary review, or `""` to auto-pick the cheapest available language model at call time (`research.md` — not hardcoded to any vendor) |
| `sensitive_path_patterns` | string[] | Glob patterns identifying auth/migrations/CI-config files that force elevated risk regardless of diff size |

**Validation rules**:
- Built-in default MUST be conservative: `risk_threshold_for_review` defaults
  to `"cosmetic"` (i.e. anything above cosmetic goes to at least
  `human-review`), never a looser default (Constitution Technical
  Constraints — conservative defaults).
- Loaded fresh on every action run; no caching across runs (so config edits
  take effect on the very next PR event, per SC-006).

## DecisionLogEntry

A record of cost and latency for a single Jev or Gemini call (FR-007).

| Field | Type | Notes |
|---|---|---|
| `call_type` | `"jev-triage" \| "fallback-review"` | Which step produced this entry |
| `pull_request_number` | number | For correlating with the triage decision |
| `input_tokens` | number | From the AI Gateway response `usage` field |
| `output_tokens` | number | From the AI Gateway response `usage` field |
| `latency_ms` | number | Wall-clock time for the call |
| `status` | `"success" \| "failure"` | Whether the call completed or fell back/failed |

**Validation rules**:
- Logged for every attempted call, including failed ones (so failure rate is
  measurable, not just successful-call cost/latency).
- MUST NOT include diff content or any field from the PR body/diff — only
  numeric usage/latency and the PR number for correlation (Constitution IV).
