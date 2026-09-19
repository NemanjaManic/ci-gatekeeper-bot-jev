import { PullRequestTriageDecision, Route, SecondaryReviewResult } from "./types";

export const COMMENT_MARKER = "<!-- jev-gatekeeper -->";

const STATUS_CHECK_LABEL: Record<Route, string> = {
  "auto-approve": "success",
  "human-review": "pending",
  block: "failure",
};

const ROUTE_REASON: Record<Route, string> = {
  "auto-approve": "This PR was judged low-risk and does not need a human review.",
  "human-review": "This PR needs a human to review it before merging.",
  block: "This PR is blocked until a human explicitly approves it.",
};

export interface CommentInput {
  decision: PullRequestTriageDecision;
  jevLatencyMs: number;
  jevUsage: { input_tokens: number; output_tokens: number };
  secondaryReview?: SecondaryReviewResult;
  fallbackLatencyMs?: number;
}

// Structure follows specs/001-jev-pr-triage/contracts/pr-comment-format.md.
// Constitution IV: never include raw diff content, under any branch below.
export function buildComment({
  decision,
  jevLatencyMs,
  jevUsage,
  secondaryReview,
  fallbackLatencyMs,
}: CommentInput): string {
  const lines: string[] = [COMMENT_MARKER, "### \u{1F9ED} Jev PR Gatekeeper", ""];

  lines.push(`**Route**: \`${decision.route}\` → status check: \`${STATUS_CHECK_LABEL[decision.route]}\``);
  lines.push(`**Risk**: \`${decision.risk}\``);
  lines.push(`**Should review?**: \`${decision.should_review}\` (signal only — did not determine the route)`);
  lines.push("");
  lines.push(
    decision.source === "fallback-default"
      ? "The fast triage step did not respond in time, so this PR was routed to human-review by default."
      : ROUTE_REASON[decision.route]
  );

  if (decision.escalated && decision.jev_recommended_route) {
    const reasonText =
      decision.escalation_reason === "sensitive-path"
        ? "a changed file matched a configured sensitive-path pattern"
        : "the configured risk threshold was exceeded";
    lines.push("");
    lines.push(
      `\u{1F53A} Escalated from Jev's recommendation (\`${decision.jev_recommended_route}\`) to \`${decision.route}\` ` +
        `because ${reasonText}.`
    );
  }

  if (decision.touches_secrets) {
    lines.push("");
    lines.push(
      "⚠️ This PR's diff contains content that looks like it could be a secret or credential. " +
        "It has not been logged or quoted here — please review manually."
    );
  }

  if (secondaryReview?.status === "completed") {
    lines.push("");
    lines.push(`#### Detailed review (\`${secondaryReview.model}\`)`);
    lines.push(secondaryReview.findings ?? "");
  } else if (secondaryReview?.status === "unavailable") {
    lines.push("");
    lines.push(
      `_A detailed secondary review (\`${secondaryReview.model}\`) was attempted but could not be completed; the routing decision above still applies._`
    );
  }

  lines.push("");
  const footerParts = [`Jev triage: ${jevLatencyMs} ms · ${jevUsage.input_tokens}/${jevUsage.output_tokens} tokens`];
  if (fallbackLatencyMs !== undefined) {
    footerParts.push(`fallback review: ${fallbackLatencyMs} ms`);
  }
  lines.push(`<sub>${footerParts.join(" · ")}</sub>`);

  return lines.join("\n");
}
