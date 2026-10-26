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
