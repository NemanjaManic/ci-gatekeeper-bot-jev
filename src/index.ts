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
    // The `ai` SDK's Vercel AI Gateway integration reads the key directly
    // from process.env.AI_GATEWAY_API_KEY (verified against
    // node_modules/@ai-sdk/gateway) — it does not accept it as a call
    // parameter, so the action input has to be bridged into that env var
    // here. core.getInput never logs the value.
    const aiGatewayApiKey = core.getInput("ai-gateway-api-key", { required: true });
    process.env.AI_GATEWAY_API_KEY = aiGatewayApiKey;

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
      secondaryReview = await runFallbackReview({ diff, changedFiles, commitMessages }, decision, config);
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
