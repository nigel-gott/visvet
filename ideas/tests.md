# Tests

A strong opinion: tests should treat large parts of the system as **black boxes** and describe their **behaviour**, BDD style. If a database is inside the box, the test runs a real one. The old reasons to split unit from integration tests mostly fall away with AI writing them, apart from speed, and integration tests can be fast now.

The visvet [methodology](methodology.md) should encourage this style.

On the map:

- Not one box per test case: too much noise.
- Coverage (🧪) already helps.
- The goal: see each black box with its **public interface as ports** on its edge (a function, its parameters, what it returns) and whether its behaviours pass.
- Writing tests this way should push the code towards clear public interfaces and private insides, which the map then shows.

This may really be its own dimension: the [behaviour dimension](behaviour-dimension.md).
