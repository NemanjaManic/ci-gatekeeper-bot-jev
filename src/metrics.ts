import * as core from "@actions/core";
import { DecisionLogEntry } from "./types";

// Constitution IV / data-model.md: entries MUST NOT include diff content or
// any field from the PR body/diff — the DecisionLogEntry type structurally
// excludes them, so there is nothing here to redact.
export function recordDecisionLogEntry(entry: DecisionLogEntry): void {
  core.info(
    `[metrics] call_type=${entry.call_type} pr=${entry.pull_request_number} ` +
      `status=${entry.status} latency_ms=${entry.latency_ms} ` +
      `input_tokens=${entry.input_tokens} output_tokens=${entry.output_tokens}`
  );
}
