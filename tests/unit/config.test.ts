import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { existsSync, readFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("fs", () => ({ existsSync, readFileSync }));

import { loadRiskConfiguration } from "../../src/config";

const ENV_KEYS = [
  "INPUT_CONFIG-PATH",
  "INPUT_RISK-THRESHOLD-FOR-REVIEW",
  "INPUT_RISK-THRESHOLD-FOR-BLOCK",
  "INPUT_FALLBACK-REVIEW-RISK-THRESHOLD",
];

function clearInputs() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("loadRiskConfiguration precedence", () => {
  beforeEach(() => {
    clearInputs();
    existsSync.mockReset().mockReturnValue(false);
    readFileSync.mockReset();
  });

  afterEach(() => {
    clearInputs();
  });

  it("falls back to conservative built-in defaults when nothing is configured", () => {
    const config = loadRiskConfiguration();
    expect(config).toMatchObject({
      source: "built-in-default",
      risk_threshold_for_review: "cosmetic",
      risk_threshold_for_block: "blocking",
      fallback_review_risk_threshold: "blocking",
      sensitive_path_patterns: [],
    });
  });

  it("prefers an action.yml input over the built-in default", () => {
    process.env["INPUT_RISK-THRESHOLD-FOR-REVIEW"] = "moderate";

    const config = loadRiskConfiguration();
    expect(config.source).toBe("action-input");
    expect(config.risk_threshold_for_review).toBe("moderate");
  });

  it("prefers repo config over an action.yml input for the same field", () => {
    process.env["INPUT_RISK-THRESHOLD-FOR-REVIEW"] = "moderate";
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue("risk_threshold_for_review: blocking\n");

    const config = loadRiskConfiguration();
    expect(config.source).toBe("repo-config");
    expect(config.risk_threshold_for_review).toBe("blocking");
  });

  it("falls back to defaults/inputs and warns when the repo config file fails to parse", () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(": not: valid: yaml: [");

    const config = loadRiskConfiguration();
    expect(config.source).toBe("built-in-default");
    expect(config.risk_threshold_for_review).toBe("cosmetic");
  });
});
