---
kind: idea
status: exploring
description: The map shows where you haven't looked or understood yet, without a reviewed-checkbox on every box.
---
# Fog of war

From video games, like the [debuffs](../../ui/src/Debuffs.tsx): the map shows **which areas you haven't looked at or understood yet**, so you know where to go next. It replaces ticking "reviewed" on every box, a 300-item checklist that never gets started.

How it should feel:

- A codebase you know is all revealed. A pull request that rewrites one area brings the fog back **there**, in proportion to how much changed.
- Never hide or blur boxes; the signal must be subtle ([visual channels](visual-channels.md)).

A possible design:

- **One number per box, familiarity**, 0 (never seen) to 1 (know it well). Raised by signals, by strength: on screen while active and close enough to read < select, expand or read code < comment.
- **Changes lower it** in proportion: 50 of 60 lines changed brings back ~80% of the fog.
- **Tied to versions, not ids:** stored against the box's content as you saw it, so a change brings fog back by itself and a rename keeps it.
- **Spreading:** a folder's familiarity is its children's, weighted by size; work on a parent gives each child a small capped share.
- **Active means** the tab is focused with input in the last ~30 seconds (touches and scrolls on phones). Idle time clears nothing.
- **Showing it:** a thin edge on each box that fills as you explore, and "explored 63%" in the top bar.
- **Private by default** in `.visvet/`, not git. Shared later, it could pick reviewers, like [ownership](ownership.md).
- **With [tours](../guided-reading/tours.md):** a finished tour clears fog along its path; the fog suggests the next tour. [Understanding checks](../guided-reading/understanding-checks.md) raise it too.
