---
kind: idea
description: Declare a machine once and mark each transition site in the code, with checks that catch drift.
---
# State machine annotations

The first big candidate for annotations in code, because [state machines](state-machines.md) are spread over it.

- **Declare** the machine once, next to its state type: its name and its states.
- **Mark** each place that makes a transition: which machine, from → to, on what event. Something like `// visvet: thread open -> resolved on dismiss`.

Pays off twice: visvet can draw the machine and show where it lives; and a reader (especially an AI, which reads code in fragments) learns a function is one step of a larger behaviour.

Keeping them honest:

- States in a mark must exist in the declaration.
- The marked function must really touch the state type (tree-sitter can check).
- A function that writes the state with no mark is flagged: a transition missing from the diagram.

First step: annotate visvet's thread lifecycle by hand. Shares its syntax with [concept annotations](concept-annotations.md).
