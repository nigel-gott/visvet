---
kind: idea
description: Rule: visvet extracts every picture from the project with tools; the AI doesn't draw the map by hand.
---
# Extracted, not drawn

Every [dimension](dimensions.md) and signal comes from the project itself: tree-sitter, off-the-shelf tools, perhaps after a one-off setup. The AI shouldn't have to read a project and write the picture by hand, because a drawn picture goes stale the moment the code changes.

- Where a project can't be read that way, the [methodology](methodology.md) offers a stack visvet reads well, or annotations ([state machines](state-machine-annotations.md), [concepts](concept-annotations.md)).
- What the AI adds is meaning on top (names, notes, [views](views.md)), not the structure.
