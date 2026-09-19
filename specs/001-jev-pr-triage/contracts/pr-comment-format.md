# Contract: PR Comment Format

The explanatory comment posted per FR-005/Constitution III. One comment per
triage run; a new commit re-triages and posts a new comment update (edit the
existing bot comment rather than piling up duplicates, identified by a hidden
marker such as `<!-- jev-gatekeeper -->`).

## Structure

```markdown
<!-- jev-gatekeeper -->
### 🧭 Jev PR Gatekeeper

**Route**: `{route}` → status check: `{success|pending|failure}`
**Risk**: `{risk}`
**Should review?**: `{should_review}` (signal only — did not determine the route)

{one-paragraph plain-language reason, e.g. "This PR only touches documentation
files, so it was auto-approved." or "This PR modifies a CI/CD workflow file,
which is treated as high risk and requires human approval."}

{IF touches_secrets == true:}
⚠️ This PR's diff contains content that looks like it could be a secret or
credential. It has not been logged or quoted here — please review manually.

{IF source == "fallback-default":}
⚠️ The fast triage step did not respond in time, so this PR was routed to
human-review by default.

{IF a SecondaryReviewResult exists with status == "completed":}
#### Detailed review
{findings}

{IF a SecondaryReviewResult exists with status == "unavailable":}
_A detailed secondary review was attempted but could not be completed; the
routing decision above still applies._

<sub>Jev triage: {latency_ms} ms · {input_tokens}/{output_tokens} tokens{ · fallback review: {latency_ms} ms if present}</sub>
```

## Rules

1. The comment MUST NOT include raw diff content under any circumstance
   (Constitution IV) — not even when explaining *why* something was flagged.
2. The comment MUST always state the `route` and a plain-language reason, even
   in the `fallback-default` (Jev failure) case (Constitution VI).
3. The comment MUST be updated in place on re-triage (new commits), not
   duplicated, so a PR's thread shows only the latest decision.
4. Cost/latency figures shown are the aggregate for that run (see
   `data-model.md` → DecisionLogEntry) — a human-readable summary, not the raw
   log.
