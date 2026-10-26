# Behaviour dimension

The system seen as what it **does**, not how it's written: black boxes, their interfaces, and their behaviours. No classes or functions. A [dimension](dimensions.md), derived from the behaviour-style [tests](tests.md).

Likely contents (still vague):

- **Black boxes** with their public interface as ports.
- **Behaviours** of each box, from the tests, with whether they pass.
- **[State machines](state-machines.md)**, e.g. a thread going open → working → resolved.
- **Flows** through a UI.
- Maybe the [data models](data-dimension.md) a box reads and writes.

More abstract than the code dimension, and probably where visvet should head. How it works isn't known yet: it hangs on a testing convention, and needs trying several ideas to see what holds up.
