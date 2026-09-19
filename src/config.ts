import * as fs from "fs";
import * as core from "@actions/core";
import * as yaml from "js-yaml";
import { Risk, RiskConfiguration } from "./types";

const BUILT_IN_DEFAULTS: Omit<RiskConfiguration, "source"> = {
  // Conservative by default (brainstorming decision): uncertain/moderate
  // risk goes to human-review, never a looser default.
  risk_threshold_for_review: "cosmetic",
  risk_threshold_for_block: "blocking",
  fallback_review_risk_threshold: "blocking",
  // "" means: auto-pick the cheapest available language model on the
  // account at call time (see fallback-review.ts) instead of pinning a
  // specific vendor/model in code.
  fallback_review_model: "",
  sensitive_path_patterns: [],
};

interface RawConfigFile {
  risk_threshold_for_review?: Risk;
  risk_threshold_for_block?: Risk;
  fallback_review_risk_threshold?: Risk;
  fallback_review_model?: string;
  sensitive_path_patterns?: string[];
}

function readRepoConfig(configPath: string): RawConfigFile {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw);
    return (parsed as RawConfigFile) ?? {};
  } catch (err) {
    core.warning(
      `Failed to parse ${configPath}, falling back to defaults/inputs: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return {};
  }
}

function readActionInputs(): RawConfigFile {
  const inputs: RawConfigFile = {};
  const riskThresholdForReview = core.getInput("risk-threshold-for-review");
  const riskThresholdForBlock = core.getInput("risk-threshold-for-block");
  const fallbackReviewRiskThreshold = core.getInput("fallback-review-risk-threshold");
  const fallbackReviewModel = core.getInput("fallback-review-model");

  if (riskThresholdForReview) inputs.risk_threshold_for_review = riskThresholdForReview as Risk;
  if (riskThresholdForBlock) inputs.risk_threshold_for_block = riskThresholdForBlock as Risk;
  if (fallbackReviewRiskThreshold) {
    inputs.fallback_review_risk_threshold = fallbackReviewRiskThreshold as Risk;
  }
  if (fallbackReviewModel) inputs.fallback_review_model = fallbackReviewModel;
  return inputs;
}

// Precedence (research.md): repo config > action.yml inputs > built-in
// defaults. Loaded fresh on every call — no caching across runs (SC-006).
export function loadRiskConfiguration(): RiskConfiguration {
  const configPath = core.getInput("config-path") || ".github/jev-gatekeeper.yml";
  const repoConfig = readRepoConfig(configPath);
  const actionInputs = readActionInputs();

  const source: RiskConfiguration["source"] =
    Object.keys(repoConfig).length > 0
      ? "repo-config"
      : Object.keys(actionInputs).length > 0
        ? "action-input"
        : "built-in-default";

  return {
    source,
    risk_threshold_for_review:
      repoConfig.risk_threshold_for_review ??
      actionInputs.risk_threshold_for_review ??
      BUILT_IN_DEFAULTS.risk_threshold_for_review,
    risk_threshold_for_block:
      repoConfig.risk_threshold_for_block ??
      actionInputs.risk_threshold_for_block ??
      BUILT_IN_DEFAULTS.risk_threshold_for_block,
    fallback_review_risk_threshold:
      repoConfig.fallback_review_risk_threshold ??
      actionInputs.fallback_review_risk_threshold ??
      BUILT_IN_DEFAULTS.fallback_review_risk_threshold,
    fallback_review_model:
      repoConfig.fallback_review_model ??
      actionInputs.fallback_review_model ??
      BUILT_IN_DEFAULTS.fallback_review_model,
    sensitive_path_patterns:
      repoConfig.sensitive_path_patterns ?? BUILT_IN_DEFAULTS.sensitive_path_patterns,
  };
}
