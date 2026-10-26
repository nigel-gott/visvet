---
kind: idea
status: exploring
description: A guided path through the code in an order that builds understanding; a view with steps.
---
# Tours

A guided path: first these concepts, then these, in an order that builds understanding. Code review has always lacked this; the map makes it possible, and the AI can write it. The problem it solves: today you start at a random box and get lost.

- A tour is a [view](views.md) with steps: walk forwards and backwards; each step picks boxes and adds notes, arrows, images or [widgets](../extending/widgets.md).
- Its own state, written for understanding, committed next to the code.
- Can be [derived from a test](../tests-and-flows/tours-from-tests.md), or [teach the language](learning-tours.md), or stop for [option questions](option-questions.md).
- Natural first stop: the [concept dimension](../dimensions/concepts/concept-dimension.md). Finishing one clears [fog of war](../box-signals/fog-of-war.md) along its path.

First wanted: a tour of visvet itself. Open: steps strand when code moves (like notes today), and how a tour says the code changed since it was written.
