import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  experimental_evaluate: vi.fn(),
  generateText: vi.fn(),
}));

import { experimental_evaluate as evaluate } from "ai";
import { escalateRoute, triagePullRequest } from "../../src/jev";
import { Risk, RiskConfiguration, Route } from "../../src/types";

const baseConfig: RiskConfiguration = {
  source: "built-in-default",
  risk_threshold_for_review: "cosmetic",
  risk_threshold_for_block: "blocking",
  fallback_review_risk_threshold: "blocking",
  fallback_review_model: "test/mock-model",
  sensitive_path_patterns: [],
};

// Mirrors the real `experimental_evaluate` result shape (verified against
// node_modules/@ai-sdk/provider/src/evaluation-model/v4/evaluation-model-v4-result.ts):
// boolean questions answer with a probability, choice questions with `choice`.
function mockJevAnswer(opts: {
  should_review: boolean;
  risk: Risk;
  route: Route;
  touches_secrets: boolean;
  input_tokens?: number;
  output_tokens?: number;
}) {
  vi.mocked(evaluate).mockResolvedValueOnce({
    answers: {
      should_review: { type: "boolean", probability: opts.should_review ? 0.95 : 0.05 },
      risk: { type: "choice", choice: opts.risk },
      route: { type: "choice", choice: opts.route },
      touches_secrets: { type: "boolean", probability: opts.touches_secrets ? 0.95 : 0.05 },
    },
    usage: {
      inputTokens: opts.input_tokens ?? 10,
      outputTokens: opts.output_tokens ?? 5,
      totalTokens: (opts.input_tokens ?? 10) + (opts.output_tokens ?? 5),
    },
    warnings: [],
    rounding: undefined,
    providerMetadata: undefined,
    response: { timestamp: new Date(), modelId: "typesafe-ai/jev" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe("escalateRoute", () => {
  it("does not escalate when risk is at/below the review threshold", () => {
    const result = escalateRoute("auto-approve", "cosmetic", ["README.md"], baseConfig);
    expect(result).toEqual({ route: "auto-approve", escalated: false, reason: null });
  });

  it("escalates auto-approve to human-review when risk exceeds the review threshold", () => {
    const result = escalateRoute("auto-approve", "moderate", ["src/index.ts"], baseConfig);
    expect(result).toEqual({ route: "human-review", escalated: true, reason: "risk-threshold" });
  });

  it("does NOT escalate an already-correct human-review verdict to block from risk alone", () => {
    // FR-006: fallback review is gated on route == "human-review" at elevated
    // risk. If risk_threshold_for_block could escalate human-review -> block
    // by itself, that path would never be reachable.
    const result = escalateRoute("human-review", "blocking", ["src/auth.ts"], baseConfig);
    expect(result).toEqual({ route: "human-review", escalated: false, reason: null });
  });

  it("escalates auto-approve straight to block when risk is at/above the block threshold", () => {
    // Guards against Jev drastically underestimating a PR.
    const result = escalateRoute("auto-approve", "blocking", ["src/auth.ts"], baseConfig);
    expect(result).toEqual({ route: "block", escalated: true, reason: "risk-threshold" });
  });

  it("escalates to block when a changed file matches a sensitive path pattern, even at moderate risk", () => {
    const config: RiskConfiguration = {
      ...baseConfig,
      sensitive_path_patterns: [".github/workflows/**"],
    };
    const result = escalateRoute("human-review", "moderate", [".github/workflows/ci.yml"], config);
    expect(result).toEqual({ route: "block", escalated: true, reason: "sensitive-path" });
  });

  it("never loosens a stricter Jev recommendation", () => {
    // Jev already said block; nothing in config should be able to downgrade it.
    const result = escalateRoute("block", "cosmetic", ["README.md"], baseConfig);
    expect(result).toEqual({ route: "block", escalated: false, reason: null });
  });

  it("treats a mixed trivial+sensitive diff at its highest risk, not an average", () => {
    const config: RiskConfiguration = {
      ...baseConfig,
      sensitive_path_patterns: [".github/workflows/**"],
    };
    const result = escalateRoute("auto-approve", "cosmetic", ["README.md", ".github/workflows/ci.yml"], config);
    expect(result).toEqual({ route: "block", escalated: true, reason: "sensitive-path" });
  });
});

describe("triagePullRequest failure fallback", () => {
  beforeEach(() => {
    vi.mocked(evaluate).mockReset();
  });

  it("defaults to human-review, source fallback-default, when the Jev call fails", async () => {
    vi.mocked(evaluate).mockRejectedValueOnce(new Error("gateway timeout"));

    const result = await triagePullRequest(
      { diff: "diff --git a/x b/x", changedFiles: ["x"], commitMessages: ["fix x"] },
      42,
      "abc123",
      baseConfig
    );

    expect(result.decision).toMatchObject({
      route: "human-review",
      jev_recommended_route: null,
      escalated: false,
      source: "fallback-default",
    });
  });

  it("computes the effective route from a successful Jev response", async () => {
    mockJevAnswer({
      should_review: false,
      risk: "cosmetic",
      route: "auto-approve",
      touches_secrets: false,
      input_tokens: 10,
      output_tokens: 5,
    });

    const result = await triagePullRequest(
      { diff: "diff --git a/README.md b/README.md", changedFiles: ["README.md"], commitMessages: ["fix typo"] },
      7,
      "def456",
      baseConfig
    );

    expect(result.decision).toMatchObject({
      route: "auto-approve",
      jev_recommended_route: "auto-approve",
      escalated: false,
      source: "jev",
    });
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });
});
