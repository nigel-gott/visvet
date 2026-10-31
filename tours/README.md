---
kind: hub
description: Guided tours through the code; how to write one.
---
# Tours

A tour is a Markdown file here with `kind: tour` in its front matter. The UI steps through it, and `visvet tours` checks it against the code.

- `# ` heading: the tour's title. `description:` in the front matter says what it is for.
- Each `## ` heading is a step. The first name in backticks in its text is the box it shows, e.g. `src/cli.rs::Cmd`, unless a line `box: <name>` names it. The text is light Markdown.
- A line `route: <text>` in a step is a short note on where the tour goes next and why, shown in purple over the map while it moves there.
- A line `view: zoomed` in a step shows its box on its own, zoomed in. Without it (or with `view: context`), the step shows the box among its neighbours: the map zooms into the box around it and opens only the step's box. Context suits most steps; zoomed suits a box whose neighbours would be too many to read.
- A `### ` heading holding code in backticks, inside a step, is a note on that exact piece of the step's box, e.g. `` ### `#[derive(Parser)]` ``. Its text is the note. It matches the code's text, not a line number, so it survives edits; run `visvet tours` to find notes whose code has changed.

Say things in notes on the code. A note sits next to the code it is about; a step's text sits apart from it, and the reader has to match each sentence to a line. Keep a step's text for its point, about the whole box, in one or two sentences. A step with nothing to add has no text and no bubble: name its box with a `box:` line, and its title shows in the tour bar. End a note with a line of links to the official docs for what it shows, e.g. `Docs: [The Book: enums](https://doc.rust-lang.org/book/ch06-01-defining-an-enum.html)`: the crate's docs, The Rust Book, the standard library, react.dev or the TypeScript handbook. Links open in a new tab.

Tours:

- [visvet from end to end](codebase.md): the whole codebase, teaching the Rust, TypeScript and React it uses, for an engineer who knows JavaScript and Vue.
- [The tour feature](tour-feature.md): a review of the tours work, by touring it.
