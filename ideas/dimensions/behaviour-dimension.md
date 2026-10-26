---
kind: idea
status: exploring
description: The system as black boxes and what they do, derived from behaviour-style tests.
---
# Behaviour dimension

The system seen as what it **does**, not how it's written: black boxes, their interfaces, and their behaviours. No classes or functions. A [dimension](dimensions.md) that exists because of [black-box tests](black-box-tests.md).

Likely contents (still vague):

- **Black boxes** with their [ports](../tests-and-flows/ports.md).
- **Behaviours** of each box, [from test names](../tests-and-flows/behaviours-from-test-names.md), with whether they pass.
- **[State machines](state-machines/state-machines.md)**, e.g. a thread going open → working → resolved.
- **[Flows](../tests-and-flows/flows.md)** through a UI.
- Maybe the [data models](data/data-dimension.md) a box reads and writes.

More abstract than the code dimension, and probably where visvet should head. How it works isn't known: it hangs on a testing convention, and needs several experiments.
