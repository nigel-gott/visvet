---
kind: idea
description: A box's ports are the members something outside it uses; the map already knows them.
---
# Ports

A box's public interface, drawn on its edge: a function, its parameters, what it returns. Everything else is private.

- Buildable today, without tests: ports are the members an arrow from outside the box reaches.
- Flags boxes with a messy surface (many things used from outside).
- [Black-box tests](black-box-tests.md) should go through ports only; [tests on the map](tests-on-the-map.md) can show which don't.
