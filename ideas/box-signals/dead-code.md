---
kind: idea
description: Suspected unused boxes, from language tools plus reachability from entry points; shown as a ghost.
---
# Dead code

A box with no incoming arrows isn't enough: a dead cycle still has arrows, and visvet's arrows come from names, so some aren't real.

- **Off-the-shelf tools** ([extracted](../extracted-not-drawn.md)): rustc's `dead_code` lint (in a binary crate it covers `pub` items too), `cargo-udeps`, `knip` for TypeScript, `vulture` for Python, `deadcode` for Go.
- **visvet's own reachability:** walk the graph from entry points (`main`, tests, exports); what isn't reached is suspect, cycles included.
- Always "suspected": reflection, macros and UI-only calls fool both.

Shown as a ghost: faded, dashed border ([visual channels](visual-channels.md)).
