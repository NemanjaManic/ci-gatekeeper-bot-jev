# Contract: Jev Evaluation Request/Response

The interface between `src/jev.ts` and Jev (`typesafe-ai/jev` via Vercel AI
Gateway, called through the Vercel AI SDK 7 `experimental_evaluate` API).

## Request (state passed to `experimental_evaluate`)

```ts
type JevTriageInput = {
  diff: string;                 // unified diff of the PR
  changedFiles: string[];       // paths only
  commitMessages: string[];
};
```

## Questions asked (typed, not free text)

| Question key | Type | Allowed values |
|---|---|---|
| `should_review` | boolean | `true` / `false` |
| `risk` | choice/score | `"cosmetic"` \| `"moderate"` \| `"blocking"` |
| `route` | choice | `"auto-approve"` \| `"human-review"` \| `"block"` |
| `touches_secrets` | boolean | `true` / `false` |

## Response shape (consumed by `src/jev.ts`)

```ts
type JevTriageResponse = {
  should_review: boolean;
  risk: "cosmetic" | "moderate" | "blocking";
  route: "auto-approve" | "human-review" | "block";
  touches_secrets: boolean;
  usage: { input_tokens: number; output_tokens: number };
};
```

## Mapping rules (enforced in `src/jev.ts`, see `data-model.md` → PullRequestTriageDecision)

1. Jev's `route` is a **recommendation**, not yet the final decision. `src/jev.ts`
   combines it with the repo's `RiskConfiguration` (`risk_threshold_for_block`,
   `sensitive_path_patterns`) to compute the **effective route**:
   - Start from Jev's `route`.
   - If Jev recommended `auto-approve`: escalate to `block` when `risk` is
     at/above `risk_threshold_for_block` (Jev drastically underestimated the
     PR), otherwise escalate to `human-review` when `risk` is above
     `risk_threshold_for_review`.
   - `risk_threshold_for_block` deliberately does NOT escalate an
     already-correct `human-review` recommendation straight to `block` on
     risk alone — FR-006's fallback review is gated on `route ==
     "human-review"` at elevated risk, so that path must stay reachable.
   - Regardless of Jev's recommendation, if any changed file matches
     `sensitive_path_patterns`, escalate the effective route to at least
     `block` (a deterministic, maintainer-curated safety net, distinct from
     the fuzzy risk score).
   - Escalation only ever makes the effective route stricter
     (`auto-approve` → `human-review` → `block`); config MUST NOT be able to
     downgrade a `block`/`human-review` recommendation to `auto-approve`.
   - This effective route — not Jev's raw answer — is written into
     `PullRequestTriageDecision.route`, and it is the only field that
     determines the GitHub status check outcome (Constitution V: whatever
     ends up in `.route` is what's authoritative, regardless of `should_review`).
2. `should_review` is copied as-is for comment rendering only; it is never
   branched on for control flow (Constitution V).
3. On call failure/timeout: no `JevTriageResponse` is produced, so there is no
   `route` to escalate. `src/jev.ts` MUST synthesize a
   `PullRequestTriageDecision` with `route: "human-review"` and
   `source: "fallback-default"` (Constitution VI, FR-009) instead of
   propagating the error past this module.
4. `usage` is forwarded to `src/metrics.ts` as a `DecisionLogEntry` with
   `call_type: "jev-triage"`; it MUST NOT be logged alongside `diff` content.
5. The PR comment (see `pr-comment-format.md`) states the *effective* route
   and, when escalation happened, says so explicitly (e.g. "escalated to
   block because this PR touches a CI/CD configuration file"), so the
   escalation is never a silent, unexplained departure from Jev's answer
   (Constitution III).
