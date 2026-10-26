---
kind: idea
status: exploring
description: visvet as a way to build AI-driven projects visually, with a recommended stack it reads well.
---
# Methodology

visvet is a review tool, but really it's a **way to build AI-driven projects visually**. An existing codebase was never designed visual-first, so opening one will always be a lesser experience. That's fine.

1. **Main path:** projects built the visvet way, with a **recommended stack** that visvet reads well. Most effort goes here.
2. **Secondary path:** any other project. The AI fills the gaps with annotations ([state machines](dimensions/state-machine-annotations.md), [concepts](dimensions/concept-annotations.md)) and [added content](extending/added-content.md).

This keeps visvet from tangling itself trying to [extract](extracted-not-drawn.md) everything from every codebase.

Stack candidates, tried only when a feature needs one: XState for front-end [state machines](dimensions/state-machines.md), a state-machine crate for Rust, `schemars` for [data models](dimensions/data-model-boundary.md), migrations as the database's source of truth, Playwright for UI flows, [black-box tests](dimensions/black-box-tests.md), and OpenTelemetry by default ([flows from tracing](tests-and-flows/flows-from-tracing.md)).
