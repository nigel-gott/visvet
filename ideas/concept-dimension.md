# Concept dimension

The ideas people use to explain the app to each other: "a review", "a thread", "a debuff", "the map", and how they relate. Not how it's coded, but how it's thought about. Cross-cutting: one concept touches code, data, behaviour and the UI.

## Where it comes from

Like [tests](tests.md) feed the [behaviour dimension](behaviour-dimension.md), **documentation feeds this one**: a subset of the docs, e.g. one Markdown file per concept, or a glossary.

- Each concept file says what it is, and links to the code, data and behaviours it lives in. visvet already turns Markdown links into arrows, so this mostly works today.
- Code can point back: a doc comment mentioning a concept.

## How it looks

More visual than any other dimension. Concepts aren't code, so boxes-and-arrows isn't enough: shapes for different kinds of concept, pictures, grouping by area, drawn diagrams.

- The AI designs and draws it, so it needs to see what it drew (screenshots in the browser pane) and fix it.
- A drawing library rather than hand-made SVG: tldraw or Excalidraw (both React; Excalidraw's file format is plain JSON that can be committed). A concept map could simply be a [widget](widgets.md) holding one.
- Concepts are boxes that can be selected and commented on like everything else.

## Why it matters

It's the first thing a newcomer needs and the thing least often written down. A good starting page for visvet, before the code map, and the natural first stop of a [tour](tours.md).
