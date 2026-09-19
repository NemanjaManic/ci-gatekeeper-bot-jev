import * as github from "@actions/github";

const COMMENT_MARKER = "<!-- jev-gatekeeper -->";

export type Octokit = ReturnType<typeof github.getOctokit>;

export interface PullRequestContext {
  owner: string;
  repo: string;
  pull_number: number;
  head_sha: string;
}

export function getPullRequestContext(): PullRequestContext {
  const { context } = github;
  const pr = context.payload.pull_request;
  if (!pr) {
    throw new Error("This action must be triggered by a pull_request event (opened/synchronize/reopened)");
  }
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pr.number as number,
    head_sha: (pr.head as { sha: string }).sha,
  };
}

export async function fetchPullRequestDiffData(
  octokit: Octokit,
  ctx: PullRequestContext
): Promise<{ diff: string; changedFiles: string[]; commitMessages: string[] }> {
  const { owner, repo, pull_number } = ctx;

  const diffResponse = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // With mediaType.format "diff", the SDK returns the raw diff text as `data`.
  const diff = diffResponse.data as unknown as string;

  const filesResponse = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number,
    per_page: 100,
  });
  const changedFiles = filesResponse.data.map((f: { filename: string }) => f.filename);

  const commitsResponse = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number,
    per_page: 100,
  });
  const commitMessages = commitsResponse.data.map((c: { commit: { message: string } }) => c.commit.message);

  return { diff, changedFiles, commitMessages };
}

// Status Check Mapping (contracts/action-interface.md). Uses the Statuses
// API (commit status) rather than the Checks API named in the original
// planning doc: it needs less workflow permission (statuses: write vs.
// checks: write) for the same maintainer-visible outcome, which matters for
// a v1 that other repos will install with a plain GITHUB_TOKEN.
export async function setStatusCheck(
  octokit: Octokit,
  ctx: PullRequestContext,
  conclusion: "success" | "pending" | "failure"
): Promise<void> {
  const description =
    conclusion === "success"
      ? "Auto-approved by Jev triage"
      : conclusion === "pending"
        ? "Awaiting human review"
        : "Blocked by Jev triage";

  await octokit.rest.repos.createCommitStatus({
    owner: ctx.owner,
    repo: ctx.repo,
    sha: ctx.head_sha,
    state: conclusion,
    context: "jev-gatekeeper",
    description,
  });
}

export async function postOrUpdateComment(octokit: Octokit, ctx: PullRequestContext, body: string): Promise<void> {
  const { owner, repo, pull_number } = ctx;
  const fullBody = body.includes(COMMENT_MARKER) ? body : `${COMMENT_MARKER}\n${body}`;

  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pull_number,
    per_page: 100,
  });
  const existing = comments.data.find((c: { body?: string }) => c.body?.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: fullBody });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: pull_number, body: fullBody });
  }
}
