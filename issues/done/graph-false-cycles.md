---
kind: issue
status: done
description: visvet graph reports cycles that aren't real: a Rust module and its own submodules, and Markdown notes linking to each other.
---
# False cycles in visvet graph

`visvet graph` lists "cycles among files" that aren't problems, which hides the real ones:

- **A Rust module and its submodules:** `src/review.rs` ↔ `src/review/compare.rs` and the rest, and `src/review/parse.rs` ↔ `src/review/parse/*.rs`. A submodule importing through `crate::review::...` or `super::` gets an arrow back to its parent file, which declared it, so every module folder is a "cycle". A parent using its own submodules isn't a cycle a reader has to untangle.
- **Markdown links:** notes in `ideas/` link to each other on purpose, so the whole folder shows as one huge cycle.

What to do, in `src/cli/graph.rs`:

- Count cycles only over code arrows (calls, uses, has, imports, creates), never "links".

What was done instead for submodules: the arrow back to the parent was false. `use crate::review::parse::join` was read as importing `review.rs`, its first part only. Imports now point at the innermost module file that exists (`src/review/parse.rs`), in `src/review/parse/rust.rs::module_files`. The false arrows are gone from the map too, and no rule hides any. What's left in the cycle list is real: `parse.rs` and the files in `parse/` use each other's types.
