---
kind: idea
status: exploring
description: The ideas people use to explain the app to each other, drawn freely; the first thing a newcomer needs.
---
# Concept dimension

The ideas people use to explain the app: "a review", "a thread", "a debuff", and how they relate. Not how it's coded, but how it's thought about. Cross-cutting: one concept touches code, data, behaviour and UI, so it's the [dimension](dimensions.md) most connected to the others.

- **Where it comes from:** mostly [concept annotations](concept-annotations.md) in the code, because separate docs go stale; docs only for the big picture.
- **How it looks:** more visual than any other dimension: shapes for kinds of concept, pictures, grouping. The AI draws it, so it must see what it drew (screenshots in the browser pane) and fix it. A drawing library, not hand-made SVG: tldraw or Excalidraw (Excalidraw saves plain JSON that can be committed), likely inside a [widget](widgets.md).
- **Why it matters:** the first thing a newcomer needs and the thing least often written down. A good starting page for visvet and the first stop of a [tour](tours.md).
- **Its best use may be for agents:** [visvet impact](visvet-impact.md) lists the concepts a change touches.
