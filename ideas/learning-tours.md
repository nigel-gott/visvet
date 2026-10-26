# Learning tours

A [tour](tours.md) whose goal is to teach the reader the language and libraries, not just the project. Example: walk through visvet's main [flows](flows.md), and on the way explain the Rust, TypeScript and React in them, plus why things were done that way.

## Rich annotations on code

The core feature this needs: an annotation on a **span of code** inside an open box, not only on a whole box.

- A syntax feature is highlighted (`?`, `impl Trait`, a lifetime, `useEffect`). Clicking it opens a small window inline.
- The window holds a note from the AI ("why it's done this way here"), and/or an excerpt of the official docs: the Rust Book, Rust by Example, std docs, React docs, with a link to the full page.
- Many doc sites refuse to be embedded in a frame, so fetch and show the relevant section, rather than embed the site.
- Same anchoring as threads and [overlays](overlays.md), so the tour survives small edits.

## Koans

Short exercises at points in the tour: "your turn".

- A small editor in the page (Monaco or CodeMirror, both drop into React) with failing code and a failing test. Make the test pass to prove you understood the feature. Rustlings is the well-known Rust version of this.
- Runs locally through the visvet server (`cargo test` on a scratch crate), so no full IDE is needed.
- Ideally the koan uses the project's own code: "this function was just explained; here's a broken copy of it".

## Other things worth having

- **Predict, then check:** "what does this print / which arrow does this call follow?" before revealing. Cheap, and works without an editor.
- **Spot the bug:** a small change to real code; find what breaks.
- **A glossary of what you've learned:** each feature you've met, linked back to where it was in the code. It ties in with [fog of war](fog-of-war.md): concepts you know, not just boxes you've seen.
- **Repetition:** concepts come back in later tours, in other code, until they stick.
- **Asking questions** is already covered: comment threads work anywhere in the tour.
