---
kind: issue
status: open
description: A left sidebar with the usual folder and file tree, kept in step with the map and with tours.
---
# File tree sidebar

A file and folder tree down the left of the map, like an editor's. You can move around the review with it, see
at a glance where the changes, threads and debuffs are, and see where the map is.

## What it shows

- One row for each folder, file, type and function, indented under its parent, with ▸/▾ to open and close it.
- On each row, as on the map boxes: the change mark (`+`, `~`, `-`), lines added and removed (`+12 −3`), and
  the debuffs (complex, long, untested).
- On each row, the number of comment threads on it. A closed row also counts the threads on the rows inside it, so
  you can follow them down.

## How it moves with the map

- The tree opens the path to the box the map is zoomed into, and that box's own children. It closes the rest. When
  the map zooms somewhere else, the tree follows.
- The selected box's row is highlighted and scrolled into view.
- Rows you open or close yourself stay that way until the map changes view.
- A click on a row does what a click on its box does: it zooms the map to the box around the row, then selects the
  row's box. The map glides there as it does for a tour step.

## How it works with tours

- The row of the step's box is marked, as the box is outlined on the map.
- With "you drive" chosen, the row of the next box to go to is marked too, so the tree is one more way to get there.
- Rows of the tour's other steps get a small step number, so you can see the whole tour in the tree.

## What there is already

`ui/src/Views.tsx::Outline` is most of this, hidden since the map became the whole review. It has the tree, the
change marks, line counts and debuffs on each row (`ui/src/Views.tsx::Head`), and it already opens the path to the
zoomed box. Its search box and "Has threads" filter can stay.

To do:

1. Put it back in `ui/src/main.tsx::App`, as a left column that you can make narrower, wider, or hide.
2. Add the thread counts and the tour marks to `ui/src/Views.tsx::Row`.
3. Make a row click move the map (`showBox`) instead of only selecting (`focus`).

## Questions

- Show types and functions under each file, or only folders and files, with the map for what is inside a file?
- Hide unchanged files with a filter, or only make their rows fainter?
