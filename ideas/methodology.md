# Methodology

visvet is a review tool, but really it's a **way to build AI-driven projects visually**, with a tool that supports it. An existing codebase was never designed visual-first, so opening one in visvet will always be a lesser experience. That's fine.

Two paths:

1. **Main path:** projects built the visvet way, with a **recommended stack**: languages and libraries that visvet reads well. For example, a state machine library it can extract [state machines](state-machines.md) from, schema tools for the [data dimension](data-dimension.md), and a test style for the [behaviour dimension](behaviour-dimension.md). Most effort goes here.
2. **Secondary path:** any other project. The AI fills the gaps: it declares state machines, patches up what tools can't read, and explains through [overlays](overlays.md).

This keeps visvet from tangling itself trying to extract everything from every codebase.
