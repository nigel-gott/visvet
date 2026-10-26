# Stacked dimensions

An experiment for moving between [dimensions](dimensions.md): use the third dimension.

Each dimension is a flat map, a plane. Stack the planes like floors of a building: concept on top, then behaviour, data, code at the bottom.

- **Normally flat:** you see one plane straight on, exactly like the map today. No added clutter.
- **Switching tilts the camera:** for a moment the view turns isometric, showing the planes stacked, and you fly up or down to the next one, then it flattens again.
- **The selection shows through:** while tilted, the selected box draws a vertical line up and down to the same thing on the other planes. Example: select the `Order` ORM model in the code; tilt; a line rises to the `orders` table on the data plane and to the "order" concept on top. That's the only time cross-dimension links are drawn.
- Holding the tilt open is the "side by side" view, without splitting the screen.

Why it might work: 2D layout stays as it is inside each plane; depth carries only "which dimension", a channel nothing else uses ([node signals](node-signals.md)).

Prior art: CodeCity (code as 3D buildings) is the famous one, mostly a lesson in 3D getting hard to read. Here 3D is only for the moment of switching.

## Simpler: stacked cards

The same idea at the size of one box. A box that also exists in other dimensions is drawn as a small stack of cards: one or two cards peek out behind it, offset a little. Nothing else is added: no badges, no labels (maybe a tiny tab edge in each dimension's colour, maybe not even that).

- Click the stack and the cards fan out: one card per dimension, each showing that dimension's version (the `orders` table, the "order" concept).
- Pick a card and you switch to that dimension, centred on it.
- A box with no stack exists in only one dimension, which is itself worth knowing.

Probably the better first experiment: it's a box style plus a small menu, and it reads at a glance.

Cheap first try of the full stack: CSS 3D transforms (perspective and a tilt) on the existing map layers, with two planes. No 3D library.
