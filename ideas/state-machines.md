# State machines

A third kind of picture, besides boxes-and-arrows code and tables-and-keys data: states and the transitions between them.

Not a [dimension](dimensions.md) of its own. It fits inside any of them, e.g. a thread's states in the code (open → working → question → resolved), or a status column in the data. Its main home is the [behaviour dimension](behaviour-dimension.md).

How to find them: in a project built the [visvet way](methodology.md), from an endorsed state machine library. Elsewhere, from annotations (below), helped by the code (an enum plus the functions that set it).

## Spread over the code

A machine is rarely in one class. The state may live in one enum or column, but its transitions happen all over: a UI button, an HTTP handler, a CLI command, a hook. Example: a user working through a to-do list. No file shows the whole machine, so nobody, human or AI, sees it.

## Annotations

The first big candidate for annotations in the code. Two kinds:

- **Declare** the machine once, next to its state type: its name and its states.
- **Mark** each place that makes a transition: which machine, from → to, and on what event.

Something like `// visvet: thread open -> resolved on dismiss`. Exact syntax later.

Why this pays off twice:

- visvet can draw the machine, and show where it lives.
- A reader landing in one function learns it's one step of a larger behaviour. Especially useful for an AI, which reads code in fragments: the annotation is greppable context it would otherwise miss.

Keeping annotations honest, since they can drift from the code:

- The states in each mark must exist in the declaration.
- The marked function must really touch the state type (tree-sitter can check).
- A function that writes the state but has no mark is flagged: a transition missing from the diagram.

## How they look

- **Notation:** the standard statechart (UML / Harel, as XState draws it): rounded boxes for states, arrows labelled `event [guard] / action`, nested states, parallel regions.
- **Machines together:** one level up, machines are boxes and the arrows are the events one machine sends to another (a thread resolved → the stop hook has nothing to hand over). Same boxes-and-arrows as the code map; zoom into a machine to see its states.
- **In the code dimension:** not the diagram. Instead, select a machine and its transition sites light up across the code map, as an [overlay](overlays.md). This answers "where does this behaviour live?", which is the question that's hard today. Maybe a small tag on boxes that take part in a machine.

## Possible first step

Annotate one machine by hand in visvet itself, the thread lifecycle, and see whether the marks read well and whether the check catches drift.
