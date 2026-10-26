---
kind: hub
description: Guided tours through the code; how to write one.
---
# Tours

A tour is a Markdown file here with `kind: tour` in its front matter. The UI steps through it, and `visvet tours` checks it against the code.

- `# ` heading: the tour's title. `description:` in the front matter says what it is for.
- Each `## ` heading is a step. The first name in backticks in its text is the box it shows, e.g. `src/cli.rs::Cmd`. The text is light Markdown.
- A `### ` heading holding code in backticks, inside a step, is a note on that exact piece of the step's box, e.g. `` ### `#[derive(Parser)]` ``. Its text is the note. It matches the code's text, not a line number, so it survives edits; run `visvet tours` to find notes whose code has changed.

Tours:

- [The tour feature](tour-feature.md): a review of the tours work, by touring it.
