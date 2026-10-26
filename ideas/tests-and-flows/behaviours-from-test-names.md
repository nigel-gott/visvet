---
kind: idea
description: Each test block names the box it tests and each test's name is a behaviour, listed per box with pass/fail.
---
# Behaviours from test names

A naming convention: each test block names the box it tests, and each test's name is a behaviour, e.g. `describe(Store) → it("hands a user reply back to the AI")`.

- visvet lists behaviours per box with pass/fail.
- This is what the [behaviour dimension](../dimensions/behaviour-dimension.md) is built from.
- A check can flag tests that reach past the named box's [ports](ports.md).
