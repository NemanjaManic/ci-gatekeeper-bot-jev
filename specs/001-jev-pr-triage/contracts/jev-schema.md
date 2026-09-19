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

1. `route` is copied as-is into `PullRequestTriageDecision.route` and is the
   only field that determines the GitHub status check outcome.
2. `should_review` is copied as-is for comment rendering only; it is never
   branched on for control flow (Constitution V).
3. On call failure/timeout: no `JevTriageResponse` is produced. `src/jev.ts`
   MUST synthesize a `PullRequestTriageDecision` with `route: "human-review"`
   and `source: "fallback-default"` (Constitution VI, FR-009) instead of
   propagating the error past this module.
4. `usage` is forwarded to `src/metrics.ts` as a `DecisionLogEntry` with
   `call_type: "jev-triage"`; it MUST NOT be logged alongside `diff` content.
