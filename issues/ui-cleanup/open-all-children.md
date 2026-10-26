---
kind: issue
status: open
description: One button to open every box in the current view at once, instead of clicking More on each.
---
# Open all boxes in a view

To read everything in a zoomed view, e.g. all three notes in `ideas/dimensions/concepts/`, you click More on each box one by one. More on the zoomed box itself doesn't help: its children are already boxes, so `ui/src/view.ts::mapView` hides that button.

What to add:

- A button on the zoomed box (where its More used to be), "Open all", that does what More does on each of its direct children. Clicking again ("Close all") closes them.
- It only adds ids to the set of open boxes that More already uses, so no new kind of state.
- Watch the layout: many open boxes make a tall view; the map should still fit it.
