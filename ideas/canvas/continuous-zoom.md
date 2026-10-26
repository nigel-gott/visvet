---
kind: idea
status: exploring
description: Lay the whole map out once, every box nested in its parent at a fixed place; zooming only moves the camera, and detail fades in as you get close.
---
# Continuous zoom

The user, 2026-10-26, taking a tour: moving between steps "flashes", "the map disappears", it "zooms into a random location". It should feel like moving around one big canvas: smooth, slow, continuous, no relayouts, and the outer view only goes once you are fully inside the inner one. And this is how zooming should work everywhere, not only in tours.

## Why it jumps today

Each zoom level is its own view with its own layout: zoomed into `src/`, ELK lays out `src/`'s files; zoomed into `src/review.rs`, it lays out that file's boxes, from scratch. A box is in a different place, at a different size, in each view. Changing view swaps one picture for another, and no camera move can hide that, because the boxes really did move.

## The design

- **One layout, nested.** Lay out the whole repo once: every box inside its parent, at a fixed place and size, all the way down to functions. Boxes never move unless the code changes.
- **Zooming is only the camera.** Double-click, Up, Back, a tour step: each is a camera move on that one canvas. The camera can glide slowly from anywhere to anywhere, and you see the path.
- **Detail by zoom level ("semantic zoom").** Far out, a folder is a labelled box; closer, its files appear inside it; closer, types and functions; closest, code. Like a map app showing streets only when you zoom in. Each box draws its insides only once it is big enough on screen to read them.
- **Cross-fade, never swap.** As you zoom into a box, its outside summary (name, member rows) fades out while its insides fade in, over the same few hundred pixels of zoom, so nothing pops. Zooming out does the reverse. (The user, 2026-10-26.)
- **Arrows by zoom level too.** Far out, arrows bundle between folders; closer, they split between files, then boxes, as today's zoom views do.

## What changes

- The layout (`ui/src/Graph.tsx::useLayout`) lays out everything nested, once per model, instead of per view.
- `ui/src/view.ts::mapView` chooses what to draw from the camera's zoom and what's on screen, not from a "zoomed into" box.
- The breadcrumb path shows where the camera is, not which view is open.
- Open (More) boxes grow, so opening one makes room for it. That moves its neighbours: the one relayout left, done as an animation.

## Risks and open questions

- **Size.** A whole-repo nested layout is much bigger: ELK on thousands of boxes may be slow, and React Flow drawing them all is too. Draw only what's on screen and big enough (virtualise); lay out once in the background.
- **Arrows.** Today's per-view arrow lifting (`linkEnds`, `bundle`) assumes a zoomed box. With one canvas, an arrow must find the boxes drawn at the current zoom at both ends.
- **One layout change at a time.** A rewrite of the map's core; the 2026-10-25 layout experiments looked terrible when several things changed at once. Build it behind a switch, beside today's views, and compare.
- Tours, `visvet show`, Back and Forward all become camera moves, which simplifies them.
