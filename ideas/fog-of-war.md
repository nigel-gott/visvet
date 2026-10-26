# Fog of war

From video games, like [debuffs](../ui/src/Debuffs.tsx): the map shows **which areas you haven't looked at or understood yet**, so you know where to go next.

It replaces ticking "reviewed" on every box, which turns review into a 300-item checklist that never gets started.

How it should feel:

- A codebase you know well is all revealed. A pull request that rewrites one area brings the fog back **there**, in proportion to how much changed.
- Never actually hide or blur boxes: anything that makes them harder to read is wrong. The signal must be subtle.

What clears it, with no clicking:

- **Looking:** a box on screen while you're **active**: moving, clicking, scrolling. Idle time doesn't count, so a page left open over lunch clears nothing. The UI needs an "are you active" marker.
- **Working:** selecting, expanding, reading the code, dragging.
- **Commenting:** a strong signal, tied to the box's version at that time.
- **Spreading:** effort on a parent counts somewhat for its children, and the other way. How much is open.

What brings it back: the box changing since you last looked, weighted by how much it changed.

## A possible design

- **One number per box: familiarity**, from 0 (never seen) to 1 (know it well). Signals raise it, weighted by strength: on screen while active and close enough to read < select, expand or read code < comment.
- **Changes lower it** in proportion to the change: 50 of 60 lines changed since you last looked brings back ~80% of the fog. The box's diff gives this.
- **Tied to versions, not ids:** store familiarity against the box's content as you saw it. A change then brings fog back by itself, and a rename keeps it (unlike notes today).
- **Spreading:** a folder's familiarity is its children's, weighted by size. Working on a parent gives each child a small capped share, e.g. a quarter.
- **Active means:** the tab is focused and there was input in the last ~30 seconds; touches and scrolls count on phones. A small top-bar marker shows tracking is on.
- **Showing it:** a thin edge on each box that fills as you explore it, and "explored 63%" per zoom level in the top bar. Or fog on the empty space between boxes, never on them.
- **Private by default:** kept on your machine in `.visvet/`, not in git. Shared later, it could show who knows which areas, to pick reviewers.
- **With [tours](tours.md):** finishing a tour clears the fog along its path, and the fog suggests which tour to take next.
