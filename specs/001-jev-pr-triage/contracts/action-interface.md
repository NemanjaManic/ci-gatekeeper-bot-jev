# Contract: `action.yml` Interface

The public interface this GitHub Action exposes to any repository/workflow
that consumes it.

## Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

(FR-001 — the action itself does not enforce this; it's documented here as the
required trigger for consumers, and validated in `quickstart.md`.)

## Inputs

| Input | Required | Default | Notes |
|---|---|---|---|
| `github-token` | yes | — | Token with permission to read PR diff, post comments, set status checks |
| `ai-gateway-api-key` | yes | — | Should be passed from a repo secret (`AI_GATEWAY_API_KEY`); never logged |
| `risk-threshold-for-review` | no | `"cosmetic"` | Overridable by `.github/jev-gatekeeper.yml` (repo config takes precedence — see `research.md`) |
| `risk-threshold-for-block` | no | `"blocking"` | Same precedence rule |
| `fallback-review-risk-threshold` | no | `"blocking"` | Minimum risk (at `route == human-review`) that triggers the Gemini secondary review |
| `config-path` | no | `.github/jev-gatekeeper.yml` | Path to the optional repo config file (FR-008) |

## Outputs

| Output | Type | Notes |
|---|---|---|
| `route` | string | Final routing decision (`auto-approve` / `human-review` / `block`) |
| `risk` | string | Final risk level |
| `touches_secrets` | boolean | Whether a possible secret was detected |

## Status Check Mapping (FR-004)

| `route` | Status check conclusion |
|---|---|
| `auto-approve` | `success` |
| `human-review` | `pending` |
| `block` | `failure` |

This mapping is the only place `route` is translated to a GitHub-visible
state; it MUST NOT be influenced by `should_review` (Constitution V).

## Secrets Handling

`ai-gateway-api-key` and `github-token` MUST be sourced from GitHub Actions
secrets by the consuming workflow, never hardcoded. Neither value, nor any PR
diff content flagged by `touches_secrets`, is ever written to `core.info`/
`core.debug` logs or PR comments (Constitution IV).
