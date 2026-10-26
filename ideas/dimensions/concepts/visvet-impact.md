---
kind: idea
description: A command listing every concept, doc, tour and thread that points at what the current diff changed.
---
# visvet impact

`visvet impact`: given the current diff, list every concept, doc, tour and thread that points at a changed box. In other words, the backlinks of the change.

- The agent runs it before finishing (or the stop hook does), so docs and [concept annotations](concept-annotations.md) get updated in the same change instead of rotting.
- Useful before any new dimension exists: Markdown links already become arrows, so docs and [tours](../../guided-reading/tours.md) pointing at code are known today.
- Small to build; probably the most practical idea from the [concept dimension](concept-dimension.md).
