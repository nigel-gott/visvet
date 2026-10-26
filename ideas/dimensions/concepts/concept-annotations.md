---
kind: idea
description: Concepts declared in doc comments next to their code, so they move with it and don't go stale.
---
# Concept annotations

Docs that describe code go stale. So the [concept dimension](concept-dimension.md) comes mostly from the code itself:

- A concept is **declared once**, in a doc comment beside the code that most "is" it (e.g. the `Order` model), with a one-paragraph definition.
- Other code **marks** that it takes part: `concept: order`.
- It sits in front of whoever edits the code, and moves with it.
- **Docs** only for what has no home in code: how concepts relate.
- **Tests:** maybe a concept's behaviours are the tests that name it. Unclear.

Same pattern as [state machine annotations](../state-machines/state-machine-annotations.md); both should share a syntax and a drift check.
