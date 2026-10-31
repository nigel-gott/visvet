---
kind: idea
status: exploring
description: Tours say most things in notes on the code; a step's own bubble is short, or not there at all.
---
# Notes-first tours

Today most of a tour step's words are in its bubble. The bubble sits apart from the code, so the reader has to
match each sentence to a line by hand. For example, the `Cargo.toml` step in `tours/codebase.md` lists ten crates
in one paragraph, and each crate already has its own line in the file.

The idea: say a thing in a note on the code it is about, and keep the step bubble for what has no single place.

## How a step reads

- **Notes carry the detail.** One note on each piece of code worth a word: `` ### `clap = ...` `` "reads the
  command line", and so on down the file. The reader's eye stays on the code.
- **The bubble is optional.** Use it only for the step's point, in one or two sentences: why this box, and what
  to look for. A step with nothing to add has no bubble. Its title and Back/Next are already in the header's tour
  bar (`1 / 59 ‹ ›`), so nothing is lost.
- **A guide for writing tours** in `tours/README.md`: put it in a note when it is about one piece of code; put it in
  the bubble only when it is about the whole step. Keep the bubble under about 40 words. `visvet tours` could
  warn about longer ones.

## What has to change

- A step names its box with the first name in backticks in its text. With no text, it needs another way to name
  it: put the box in the `## ` heading, or add a `box:` line like `route:` and `view:`.
- The step's title shows in the tour bar when there is no bubble.
- The step's box is outlined as now, and its first note is scrolled into view, so the eye knows where to start.

## My suggestions

- Start by rewriting a few steps of the codebase tour (`Cargo.toml`, `src/main.rs`, `src/cli.rs`) this way.
  They show quickly whether it reads better, before any code changes.
- Notes in order down the file read like a walk through it. With [margin notes](margin-notes.md) many notes on
  one box stay readable, because they don't push the code apart.
- Some steps are about how boxes connect, not about lines of code. Those keep a short bubble, or use notes on
  boxes (`` ### `src/cli.rs::Cmd` ``), which already exist.
