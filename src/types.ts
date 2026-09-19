export type Risk = "cosmetic" | "moderate" | "blocking";
export type Route = "auto-approve" | "human-review" | "block";

export const RISK_ORDER: Record<Risk, number> = {
  cosmetic: 0,
  moderate: 1,
  blocking: 2,
};

export const ROUTE_ORDER: Record<Route, number> = {
  "auto-approve": 0,
  "human-review": 1,
  block: 2,
};

export function stricterRoute(a: Route, b: Route): Route {
  return ROUTE_ORDER[a] >= ROUTE_ORDER[b] ? a : b;
}

export interface JevTriageInput {
  diff: string;
  changedFiles: string[];
  commitMessages: string[];
}

export interface JevTriageResponse {
  should_review: boolean;
  risk: Risk;
  route: Route;
  touches_secrets: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export interface PullRequestTriageDecision {
  pull_request_number: number;
  head_sha: string;
  should_review: boolean;
  risk: Risk;
  jev_recommended_route: Route | null;
  route: Route;
  escalated: boolean;
  // Which mechanism caused the escalation, so the PR comment can name it
  // specifically instead of a generic "a threshold or pattern matched".
  escalation_reason: "risk-threshold" | "sensitive-path" | null;
  touches_secrets: boolean;
  source: "jev" | "fallback-default";
}

export interface SecondaryReviewResult {
  triage_decision_ref: { pull_request_number: number; head_sha: string };
  status: "completed" | "unavailable";
  findings: string | null;
  model: string;
}

export interface RiskConfiguration {
  source: "repo-config" | "action-input" | "built-in-default";
  risk_threshold_for_review: Risk;
  risk_threshold_for_block: Risk;
  fallback_review_risk_threshold: Risk;
  // Any Vercel AI Gateway model id (e.g. "google/gemini-2.0-flash",
  // "anthropic/claude-sonnet-5", "openai/gpt-4o-mini"), or "" (the default)
  // to auto-pick the cheapest available language model on the account via
  // gateway.getAvailableModels() at call time. Not hardcoded to any vendor.
  fallback_review_model: string;
  sensitive_path_patterns: string[];
}

export interface DecisionLogEntry {
  call_type: "jev-triage" | "fallback-review";
  pull_request_number: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: "success" | "failure";
}
