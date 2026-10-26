# Stacked dimensions

An experiment for moving between [dimensions](dimensions.md): use the third dimension.

Each dimension is a flat map, a plane. Stack the planes like floors of a building: concept on top, then behaviour, data, code at the bottom.

- **Normally flat:** you see one plane straight on, exactly like the map today. No added clutter.
- **Switching tilts the camera:** for a moment the view turns isometric, showing the planes stacked, and you fly up or down to the next one, then it flattens again.
- **The selection shows through:** while tilted, the selected box draws a vertical line up and down to the same thing on the other planes. Example: select the `Order` ORM model in the code; tilt; a line rises to the `orders` table on the data plane and to the "order" concept on top. That's the only time cross-dimension links are drawn.
- Holding the tilt open is the "side by side" view, without splitting the screen.

Why it might work: 2D layout stays as it is inside each plane; depth carries only "which dimension", a channel nothing else uses ([node signals](node-signals.md)).

Prior art: CodeCity (code as 3D buildings) is the famous one, mostly a lesson in 3D getting hard to read. Here 3D is only for the moment of switching.

Cheap first try: CSS 3D transforms (perspective and a tilt) on the existing map layers, with two planes. No 3D library.
