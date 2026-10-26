# Methodology

visvet is a review tool, but really it's a **way to build AI-driven projects visually**, with a tool that supports it. An existing codebase was never designed visual-first, so opening one in visvet will always be a lesser experience. That's fine.

Two paths:

1. **Main path:** projects built the visvet way, with a **recommended stack**: languages and libraries that visvet reads well. For example, a state machine library it can extract [state machines](state-machines.md) from, schema tools for the [data dimension](data-dimension.md), and a test style for the [behaviour dimension](behaviour-dimension.md). Most effort goes here.
2. **Secondary path:** any other project. The AI fills the gaps: it declares state machines, patches up what tools can't read, and explains by [adding to the map](added-content.md).

This keeps visvet from tangling itself trying to extract everything from every codebase.

Candidates for the recommended stack, to try only when a feature needs one: XState for front-end state machines (it already has visualisers), a state-machine crate for Rust, `schemars` for JSON schemas, migrations as the source of truth for databases, Playwright tests for UI flows. And OpenTelemetry tracing by default: it helps debugging, and it produces the [flows](flows.md).
