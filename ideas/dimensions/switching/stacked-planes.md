---
kind: idea
status: parked
description: Dimensions as stacked planes; the camera tilts isometric for a moment to move between them.
---
# Stacked planes

Each [dimension](../dimensions.md) is a flat plane, stacked like floors: concept on top, then behaviour, data, code at the bottom.

- **Normally flat:** one plane straight on, exactly like the map today.
- **Switching tilts the camera:** for a moment the view turns isometric and you fly up or down.
- **The selection shows through:** while tilted, the selected box draws a vertical line to the same thing on other planes (the `Order` model up to the `orders` table and the "order" concept). The only time cross-dimension links are drawn.
- Depth carries only "which dimension", a [channel](../../box-signals/visual-channels.md) nothing else uses.

Prior art: CodeCity (code as 3D buildings), mostly a lesson in 3D getting hard to read; here 3D is only for the moment of switching. Cheap try: CSS 3D transforms on the existing map. Parked behind [stacked cards](stacked-cards.md).
