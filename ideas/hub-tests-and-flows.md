---
kind: hub
description: Behaviour tests, how they show on the map, and the flows they trace through the code.
---
# Tests and flows

The stance: [black-box tests](black-box-tests.md) of behaviour, not implementation.

On the code map:

- [Ports](ports.md): a box's public surface, the thing tests should go through.
- [Tests on the map](tests-on-the-map.md): hidden by default, and where each test enters.
- [Implementation-coupled tests](implementation-coupled-tests.md): measured from git.
- [Behaviours from test names](behaviours-from-test-names.md): feeds the [behaviour dimension](behaviour-dimension.md).

Flows:

- [Flows](flows.md): many boxes lit up along one path.
- [Flows from tracing](flows-from-tracing.md): how a test run produces one.
- [Committed flows](committed-flows.md): saved in git, so a changed flow shows in review.
- [Tours from tests](tours-from-tests.md): a test read as a tour.
