# State machines

A third kind of picture, besides boxes-and-arrows code and tables-and-keys data: states and the transitions between them.

Not a [dimension](dimensions.md) of its own. It fits inside any of them, e.g. a thread's states in the code (open → working → question → resolved), or a status column in the data.

How to find them: in a project built the [visvet way](methodology.md), from an endorsed state machine library, or a light annotation. Elsewhere, partly from code (an enum plus the functions that set it), and the AI declares the rest. They also belong in the [behaviour dimension](behaviour-dimension.md).
