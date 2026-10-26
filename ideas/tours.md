# Tours

A guided path through a codebase: first these concepts, then these, in an order that builds understanding. Code review has always lacked this; the map makes it possible, and the AI can write it.

- **Simplest form:** an ordered list of steps. Each step is a box on the map plus some text from the AI.
- **A tour is an [overlay](overlays.md)** with steps: walk forwards and backwards, and each step can rearrange boxes, add markers, extra arrows, images.
- **Not from the code.** A tour is its own state, written for understanding. Like [threads](../.visvet/threads/), it would live in git next to the code.
- **The problem it solves:** today you jump into the graph at a random box and get lost.

First wanted: a tour of visvet itself.

Open questions:

- When code moves or is renamed, steps point at boxes that no longer exist. The same thing already strands notes.
- How does a tour tell its reader that the code changed since it was written?
