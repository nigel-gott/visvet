---
kind: idea
description: Traced flows are saved in git, so a changed flow shows up in review and a broken one is a bug.
---
# Committed flows

[Flows from tracing](flows-from-tracing.md) are saved in the repo and committed.

- A flow that changes shows as a diff in review: "this request now also goes through X". Often the most useful thing to review.
- A flow that breaks or vanishes unexpectedly is a bug, like a failing test.
- Saved, not re-run on every view, so the map stays fast.
- Format: OpenTelemetry spans, trimmed to what the map needs (which box called which, in what order).
