---
kind: idea
status: exploring
description: States and transitions: a kind of picture that appears in several dimensions, spread over the code.
---
# State machines

A third kind of picture, besides boxes-and-arrows code and tables-and-keys data: states and the transitions between them. Not a [dimension](../dimensions.md); it fits inside several, mainly the [behaviour dimension](../behaviour-dimension.md).

- **Spread over the code:** the state lives in one enum or column, but transitions happen all over: a UI button, an HTTP handler, a CLI command, a hook. No file shows the whole machine, so nobody sees it. That's why they need [annotations](state-machine-annotations.md).
- **Notation:** the standard statechart (UML / Harel, as XState draws it): rounded boxes for states, arrows labelled `event [guard] / action`, nested states, parallel regions.
- **Machines together:** one level up, machines are boxes and arrows are events one machine sends another (a thread resolved → the stop hook has nothing to hand over). Zoom into a machine to see its states.
- **In the code dimension:** not the diagram; select a machine and its transition sites light up across the code map. Answers "where does this behaviour live?".
- **With a library:** in a project built the [visvet way](../../methodology.md), read from an endorsed state machine library instead.
