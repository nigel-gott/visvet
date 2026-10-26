---
kind: issue
status: open
description: A tour is a Markdown file in tours/; each ## heading is a step on one box, with notes on exact pieces of its code.
---
# Tour files

- `tours/<name>.md`, front matter `kind: tour` and a `description:`.
- Each `##` heading is a step. Its first line names the box in backticks, e.g. `` `src/cli.rs::Cmd` ``; the rest is the step's text.
- A `###` heading in backticks inside a step is an annotation on that exact piece of the box's code, e.g. `` ### `#[derive(Parser)]` ``; its text is the note. Matching code text, not line numbers, so it survives edits.
- The server parses tours into the review JSON; a step whose box or code is gone is marked stale.
- A view is a tour with one step.
