---
kind: idea
description: A plugin is any executable that prints boxes, arrows and signals in visvet's format; data only, never looks.
---
# Plugins as programs

A plugin is any executable that reads the project and prints data in visvet's own format: extra boxes, arrows, debuffs, annotations. Any language, nothing linked into Rust; the same idea as git hooks or language servers.

- Most extension ideas are just this: a [dead code](../box-signals/dead-code.md) tool, [ownership](../box-signals/ownership.md), a team's own rules.
- **Data, never looks:** visvet decides how data is drawn ([visual channels](../box-signals/visual-channels.md)), so plugins can't fight over the screen. [Widgets](widgets.md) are the way to add looks.
- The same format agents use for [added content](added-content.md).

Rung 3 of the [extension ladder](extension-ladder.md).
