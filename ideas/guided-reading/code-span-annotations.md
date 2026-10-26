---
kind: idea
description: Annotations on a span of code inside a box, opening a note or a doc excerpt inline.
---
# Code span annotations

An annotation on a **span of code** inside an open box, not only a whole box. The core feature of [learning tours](learning-tours.md).

- A syntax feature is highlighted (`?`, `impl Trait`, a lifetime, `useEffect`). Clicking opens a small window inline.
- It holds a note from the AI ("why it's done this way here") and/or an excerpt of the official docs (Rust Book, Rust by Example, std, React), with a link.
- Doc sites usually refuse to be framed, so fetch and show the relevant section.
- Same anchoring as threads, to survive small edits.
