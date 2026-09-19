import * as core from "@actions/core";
import * as github from "@actions/github";
import { buildComment } from "./comment";
import { loadRiskConfiguration } from "./config";
import { runFallbackReview, shouldRunFallbackReview } from "./fallback-review";
import { fetchPullRequestDiffData, getPullRequestContext, postOrUpdateComment, setStatusCheck } from "./github";
import { triagePullRequest } from "./jev";
import { Route } from "./types";

const STATUS_CHECK_CONCLUSION: Record<Route, "success" | "pending" | "failure"> = {
  "auto-approve": "success",
  "human-review": "pending",
  block: "failure",
};

export async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token", { required: true });
    // The `ai-gateway-api-key` input is expected to be exported by the
    // consuming workflow as the AI_GATEWAY_API_KEY environment variable,
    // which the `ai` SDK reads directly — never logged here.

    const octokit = github.getOctokit(token);
    const ctx = getPullRequestContext();
    const config = loadRiskConfiguration();

    const { diff, changedFiles, commitMessages } = await fetchPullRequestDiffData(octokit, ctx);

    const { decision, usage, latency_ms } = await triagePullRequest(
      { diff, changedFiles, commitMessages },
      ctx.pull_number,
      ctx.head_sha,
      config
    );

    let secondaryReview;
    let fallbackLatencyMs: number | undefined;
    if (shouldRunFallbackReview(decision, config)) {
      const fallbackStart = Date.now();
      secondaryReview = await runFallbackReview({ diff, changedFiles, commitMessages }, decision);
      fallbackLatencyMs = Date.now() - fallbackStart;
    }

    await setStatusCheck(octokit, ctx, STATUS_CHECK_CONCLUSION[decision.route]);

    const body = buildComment({
      decision,
      jevLatencyMs: latency_ms,
      jevUsage: usage,
      secondaryReview,
      fallbackLatencyMs,
    });
    await postOrUpdateComment(octokit, ctx, body);

    core.setOutput("route", decision.route);
    core.setOutput("risk", decision.risk);
    core.setOutput("touches_secrets", decision.touches_secrets);
  } catch (error) {
    // Constitution VI: a GitHub API (or other unexpected) failure fails the
    // action loudly rather than silently.
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (require.main === module) {
  void run();
}
