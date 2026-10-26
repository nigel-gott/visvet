# Concept dimension

The ideas people use to explain the app to each other: "a review", "a thread", "a debuff", "the map", and how they relate. Not how it's coded, but how it's thought about. Cross-cutting: one concept touches code, data, behaviour and the UI.

## Where it comes from

Docs that describe the code go stale, so as little as possible lives in separate docs:

- **Annotations in the code:** a concept is declared once, in a doc comment next to the code that is most "it" (e.g. the `Order` model), with a one-paragraph definition. Other code marks that it takes part: `concept: order`. Hard to go stale, because it sits beside the code it describes and moves with it.
- **Docs** only for what has no home in code: how concepts relate, the big picture. visvet already turns Markdown links into arrows, so docs pointing at code show up today.
- **Tests:** maybe a concept's behaviours are the tests that name it. Unclear yet.

## Backlinks for agents

The most practical use may be for the AI editing code: before changing a box, see what points at it (concepts, docs, tours, threads) and update those too. A command for it:

- `visvet impact`: given the current diff, list every concept, doc, tour and thread that points at a changed box. The agent runs it before finishing (or the stop hook does), so docs get updated in the same change instead of rotting.

## How it looks

More visual than any other dimension. Concepts aren't code, so boxes-and-arrows isn't enough: shapes for different kinds of concept, pictures, grouping by area, drawn diagrams.

- The AI designs and draws it, so it needs to see what it drew (screenshots in the browser pane) and fix it.
- A drawing library rather than hand-made SVG: tldraw or Excalidraw (both React; Excalidraw's file format is plain JSON that can be committed). A concept map could simply be a [widget](widgets.md) holding one.
- Concepts are boxes that can be selected and commented on like everything else.

## Why it matters

It's the first thing a newcomer needs and the thing least often written down. A good starting page for visvet, before the code map, and the natural first stop of a [tour](tours.md).
