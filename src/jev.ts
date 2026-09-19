// The exact shape of Vercel AI SDK 7's `experimental_evaluate` was verified
// against the installed `ai@7.0.107` package (see
// node_modules/@ai-sdk/provider/src/evaluation-model/v4/): each question
// needs an `instructions` string; boolean questions answer with a
// `probability` (not a plain true/false), and choice questions answer with
// a `choice` string matching one of the `criteria` keys. `should_review` and
// `touches_secrets` are thresholded at probability > 0.5 below.
import * as core from "@actions/core";
import { experimental_evaluate as evaluate } from "ai";
import { minimatch } from "minimatch";
import { recordDecisionLogEntry } from "./metrics";
import {
  JevTriageInput,
  JevTriageResponse,
  PullRequestTriageDecision,
  RISK_ORDER,
  Risk,
  RiskConfiguration,
  Route,
  stricterRoute,
} from "./types";

async function callJev(input: JevTriageInput): Promise<JevTriageResponse> {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    // `state` must be a plain JSON value per the SDK's opaque input type;
    // JevTriageInput is already JSON-safe, it just lacks a declared index
    // signature for structural typing purposes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: input as any,
    questions: {
      should_review: {
        type: "boolean",
        instructions:
          "Does this pull request need a human or LLM code review at all, or is it trivial " +
          "(docs-only, typo-only, or generated-file-only changes)?",
      },
      risk: {
        type: "choice",
        instructions: "How risky is this change, based on the diff content and changed files?",
        criteria: {
          cosmetic: "Docs, comments, formatting, or other non-functional changes.",
          moderate: "Ordinary code changes with limited blast radius.",
          blocking:
            "Touches authentication, database migrations, CI/CD configuration, or other sensitive surface area.",
        },
      },
      route: {
        type: "choice",
        instructions: "Given the risk above, how should this PR be routed?",
        criteria: {
          "auto-approve": "Safe to merge without further review.",
          "human-review": "A human should review this before it is merged.",
          block: "This must not be merged until a human explicitly approves it.",
        },
      },
      touches_secrets: {
        type: "boolean",
        instructions: "Does the diff contain content that looks like an API key, password, or other credential?",
      },
    },
  });

  const { answers, usage } = result;

  return {
    should_review: answers.should_review.probability > 0.5,
    risk: answers.risk.choice as Risk,
    route: answers.route.choice as Route,
    touches_secrets: answers.touches_secrets.probability > 0.5,
    usage: {
      input_tokens: usage.inputTokens ?? 0,
      output_tokens: usage.outputTokens ?? 0,
    },
  };
}

function matchesSensitivePath(changedFiles: string[], patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return changedFiles.some((file) => patterns.some((pattern) => minimatch(file, pattern)));
}

export type EscalationReason = "risk-threshold" | "sensitive-path" | null;

// Config-driven escalation only ever tightens the decision, never loosens it
// (data-model.md validation rule; contracts/jev-schema.md mapping rule 1).
export function escalateRoute(
  jevRoute: Route,
  risk: Risk,
  changedFiles: string[],
  config: RiskConfiguration
): { route: Route; escalated: boolean; reason: EscalationReason } {
  let effective = jevRoute;
  let reason: EscalationReason = null;

  // risk_threshold_for_block only ever escalates a Jev "auto-approve" verdict
  // (guarding against Jev drastically underestimating a PR) — it must NOT
  // also escalate an already-correct "human-review" verdict straight to
  // "block", because FR-006's fallback review is specifically gated on
  // `route == "human-review"` at elevated risk; forcing block here would
  // make that path unreachable for exactly the PRs it's meant to cover.
  if (jevRoute === "auto-approve") {
    if (RISK_ORDER[risk] >= RISK_ORDER[config.risk_threshold_for_block]) {
      effective = stricterRoute(effective, "block");
      reason = "risk-threshold";
    } else if (RISK_ORDER[risk] > RISK_ORDER[config.risk_threshold_for_review]) {
      effective = stricterRoute(effective, "human-review");
      reason = "risk-threshold";
    }
  }

  // Sensitive-path matches are a deterministic, maintainer-curated safety
  // net and MAY escalate any route (including human-review) to block.
  if (matchesSensitivePath(changedFiles, config.sensitive_path_patterns)) {
    if (stricterRoute(effective, "block") !== effective) {
      reason = "sensitive-path";
    }
    effective = stricterRoute(effective, "block");
  }

  return { route: effective, escalated: effective !== jevRoute, reason: effective !== jevRoute ? reason : null };
}

export interface TriageResult {
  decision: PullRequestTriageDecision;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

export async function triagePullRequest(
  input: JevTriageInput,
  pull_request_number: number,
  head_sha: string,
  config: RiskConfiguration
): Promise<TriageResult> {
  const startedAt = Date.now();
  let response: JevTriageResponse;

  try {
    response = await callJev(input);
  } catch (err) {
    // Log the error message (never the diff/state passed to Jev) so a real
    // failure is diagnosable instead of silently falling back every time.
    core.warning(`Jev triage call failed, defaulting to human-review: ${err instanceof Error ? err.message : String(err)}`);
    const latency_ms = Date.now() - startedAt;
    recordDecisionLogEntry({
      call_type: "jev-triage",
      pull_request_number,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms,
      status: "failure",
    });

    // Constitution VI / FR-009: safe default on failure, never silent
    // auto-approve.
    return {
      decision: {
        pull_request_number,
        head_sha,
        should_review: true,
        risk: "moderate",
        jev_recommended_route: null,
        route: "human-review",
        escalated: false,
        escalation_reason: null,
        touches_secrets: false,
        source: "fallback-default",
      },
      usage: { input_tokens: 0, output_tokens: 0 },
      latency_ms,
    };
  }

  const latency_ms = Date.now() - startedAt;
  recordDecisionLogEntry({
    call_type: "jev-triage",
    pull_request_number,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms,
    status: "success",
  });

  const { route, escalated, reason } = escalateRoute(response.route, response.risk, input.changedFiles, config);

  return {
    decision: {
      pull_request_number,
      head_sha,
      should_review: response.should_review,
      risk: response.risk,
      jev_recommended_route: response.route,
      route,
      escalated,
      escalation_reason: reason,
      touches_secrets: response.touches_secrets,
      source: "jev",
    },
    usage: response.usage,
    latency_ms,
  };
}
