---
kind: idea
description: Tests edited in commits that changed no ports are tied to implementation details; count them from git.
---
# Implementation-coupled tests

Measured from git: a commit that changes no [ports](ports.md) but still has to edit tests reveals tests tied to implementation details, breaking the [black-box](black-box-tests.md) rule.

visvet can count this per test, over history, giving a number to watch while an AI writes tests.
