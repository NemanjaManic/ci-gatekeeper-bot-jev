// NOTE: same "verify against installed package" caveat as jev.ts — this
// uses the standard `generateText` API (free-text detailed review), not
// `experimental_evaluate` (typed decisions), since FR-006's secondary
// review is meant to produce human-readable findings.
import * as core from "@actions/core";
import { gateway, generateText } from "ai";
import { recordDecisionLogEntry } from "./metrics";
import { JevTriageInput, PullRequestTriageDecision, RISK_ORDER, RiskConfiguration, SecondaryReviewResult } from "./types";

// Constitution II — escalate only when necessary: only PRs routed to
// human-review at/above the configured fallback threshold get the detailed
// review (data-model.md validation rule).
export function shouldRunFallbackReview(decision: PullRequestTriageDecision, config: RiskConfiguration): boolean {
  return decision.route === "human-review" && RISK_ORDER[decision.risk] >= RISK_ORDER[config.fallback_review_risk_threshold];
}

// No vendor/model is hardcoded here: if the maintainer hasn't pinned one via
// config, this discovers whatever language models the account's AI Gateway
// actually has access to and picks the cheapest by combined input+output
// price per token — resilient to a specific model being unavailable/renamed,
// and consistent with the project's cheap-first ethos.
async function pickCheapestAvailableModel(): Promise<string> {
  const { models } = await gateway.getAvailableModels();
  const priced = models.filter(
    (m) => (m.modelType ?? "language") === "language" && m.pricing != null
  );

  if (priced.length === 0) {
    throw new Error("No priced language models available on this AI Gateway account");
  }

  const costOf = (m: (typeof priced)[number]) => Number(m.pricing!.input) + Number(m.pricing!.output);

  return priced.reduce((cheapest, m) => (costOf(m) < costOf(cheapest) ? m : cheapest)).id;
}

function buildReviewPrompt(input: JevTriageInput, decision: PullRequestTriageDecision): string {
  return [
    "You are performing a detailed code review for a pull request that a fast",
    "triage step flagged as human-review with elevated risk.",
    `Risk level: ${decision.risk}. Changed files: ${input.changedFiles.join(", ")}.`,
    "Review the diff below and summarize, concisely, the key concerns a human",
    "reviewer should focus on.",
    "",
    input.diff,
  ].join("\n");
}

export async function runFallbackReview(
  input: JevTriageInput,
  decision: PullRequestTriageDecision,
  config: RiskConfiguration
): Promise<SecondaryReviewResult> {
  const ref = { pull_request_number: decision.pull_request_number, head_sha: decision.head_sha };
  const startedAt = Date.now();
  let model = config.fallback_review_model;

  try {
    if (!model) {
      model = await pickCheapestAvailableModel();
    }

    const result = await generateText({
      model,
      prompt: buildReviewPrompt(input, decision),
    });

    recordDecisionLogEntry({
      call_type: "fallback-review",
      pull_request_number: decision.pull_request_number,
      input_tokens: result.usage.inputTokens ?? 0,
      output_tokens: result.usage.outputTokens ?? 0,
      latency_ms: Date.now() - startedAt,
      status: "success",
    });

    return { triage_decision_ref: ref, status: "completed", findings: result.text, model };
  } catch (err) {
    core.warning(`Fallback review call failed: ${err instanceof Error ? err.message : String(err)}`);
    recordDecisionLogEntry({
      call_type: "fallback-review",
      pull_request_number: decision.pull_request_number,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: Date.now() - startedAt,
      status: "failure",
    });

    // FR-006 Acceptance Scenario 3: primary decision still stands; comment
    // states the detailed review was unavailable (see comment.ts).
    return { triage_decision_ref: ref, status: "unavailable", findings: null, model: model || "unknown" };
  }
}
