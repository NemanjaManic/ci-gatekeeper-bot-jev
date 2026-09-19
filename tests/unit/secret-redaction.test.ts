import * as core from "@actions/core";
import { describe, expect, it, vi } from "vitest";
import { buildComment } from "../../src/comment";
import { recordDecisionLogEntry } from "../../src/metrics";
import { PullRequestTriageDecision } from "../../src/types";

const SECRET_LOOKING_DIFF = "diff --git a/.env b/.env\n+API_KEY=sk-super-secret-value-123";

function baseDecision(overrides: Partial<PullRequestTriageDecision> = {}): PullRequestTriageDecision {
  return {
    pull_request_number: 1,
    head_sha: "sha1",
    should_review: true,
    risk: "blocking",
    jev_recommended_route: "block",
    route: "block",
    escalated: false,
    escalation_reason: null,
    touches_secrets: true,
    source: "jev",
    ...overrides,
  };
}

describe("buildComment secret redaction", () => {
  it("never includes the raw diff content, even when touches_secrets is true", () => {
    const comment = buildComment({
      decision: baseDecision(),
      jevLatencyMs: 120,
      jevUsage: { input_tokens: 50, output_tokens: 20 },
    });

    expect(comment).not.toContain("sk-super-secret-value-123");
    expect(comment).not.toContain(SECRET_LOOKING_DIFF);
    expect(comment).toContain("could be a secret or credential");
  });

  it("does not render the secrets warning when touches_secrets is false", () => {
    const comment = buildComment({
      decision: baseDecision({ touches_secrets: false }),
      jevLatencyMs: 80,
      jevUsage: { input_tokens: 10, output_tokens: 5 },
    });

    expect(comment).not.toContain("could be a secret or credential");
  });
});

describe("recordDecisionLogEntry", () => {
  it("only logs numeric usage/latency and correlation fields, never diff content", () => {
    const infoSpy = vi.spyOn(core, "info").mockImplementation(() => {});

    recordDecisionLogEntry({
      call_type: "jev-triage",
      pull_request_number: 99,
      input_tokens: 12,
      output_tokens: 34,
      latency_ms: 56,
      status: "success",
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const loggedLine = infoSpy.mock.calls[0][0];
    expect(loggedLine).not.toContain("diff");
    expect(loggedLine).toContain("pr=99");
    expect(loggedLine).toContain("input_tokens=12");

    infoSpy.mockRestore();
  });
});
