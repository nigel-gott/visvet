---
kind: idea
status: exploring
description: Tests treat big parts of the system as black boxes and check behaviour; unchanged behaviour never fails a test.
---
# Black-box tests

Tests should treat large parts of the system as **black boxes** and describe their **behaviour**, BDD style. If a database is inside the box, the test runs a real one.

- **The rule:** if behaviour didn't change, no test should fail. Only breaking a public interface, or changing behaviour, should.
- The old reasons to split unit from integration tests mostly fall away with AI writing them, apart from speed, and integration tests can be fast now.
- AI tends to write many little tests of private details instead. visvet should make that visible: [tests on the map](../tests-and-flows/tests-on-the-map.md), [implementation-coupled tests](../tests-and-flows/implementation-coupled-tests.md).
- Writing tests this way pushes code towards clear [ports](../tests-and-flows/ports.md) and private insides, which the map then shows.

Part of the [methodology](../methodology.md); feeds the [behaviour dimension](behaviour-dimension.md).
