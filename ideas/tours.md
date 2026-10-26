# Tours

A guided path through a codebase: first these concepts, then these, in an order that builds understanding. Code review has always lacked this; the map makes it possible, and the AI can write it.

- **Simplest form:** an ordered list of steps. Each step is a box on the map plus some text from the AI.
- **A tour is a [view](views.md) with steps:** walk forwards and backwards; each step can pick boxes and add notes, arrows, images or [widgets](widgets.md).
- **Not from the code.** A tour is its own state, written for understanding. Like [threads](../.visvet/threads/), it would live in git next to the code.
- **The problem it solves:** today you jump into the graph at a random box and get lost.

- **A tour from a test:** a behaviour test already reads like a tour: given this state, when this happens, then this. With tracing, the test's [flow](flows.md) gives the boxes in order and the test's own steps give the text. A tour derived from a test can't go stale: it's re-derived on every run.

First wanted: a tour of visvet itself.

Open questions:

- When code moves or is renamed, steps point at boxes that no longer exist. The same thing already strands notes.
- How does a tour tell its reader that the code changed since it was written?
