---
kind: idea
status: exploring
description: Notes on code hang in the margin beside it, with the code they are about outlined, so the code stays in one piece.
---
# Margin notes

Today a note on code (`ui/src/Tours.tsx::CodeBubble`) is a bubble put in between the lines, right under its code.
That breaks the code apart. With many notes, the function is hard to read as a whole.

The idea: another way to show the same notes, as margin notes, like comments in a shared document.

## How it looks

- The code stays in one piece. The code each note is about is outlined or highlighted, exactly from its start
  to its end (each note already knows its `CodeSpan`), not only its whole line.
- Each note is a small bubble in the margin to the right of the code box, level with its code, and joined to the
  outline by a thin line.
- Notes close together are stacked so they don't overlap. A note can then sit a little lower than its code; the
  line still joins them.
- Hovering a note or its outline makes both stand out, so it is clear which goes with which.

## Choosing between the two

- A switch beside the tour speed: "notes in the code" (as now) or "notes in the margin".
- Or chosen for you: in the margin when a box has more than two or three notes, in the code when it has one.
  I would start with the switch, to compare them on real steps.

## What is hard

- Room: a code box on the map is a fixed width, and boxes sit close together. The margin needs space to the
  right of the box, so the layout must leave room for it, as it already does for the step bubble
  (`ui/src/Tours.tsx::StepBubbleBox`).
- Long notes in a narrow margin get tall. Notes that are kept short (see [notes-first tours](notes-first-tours.md))
  fit best.

## My suggestions

- Build it together with [notes-first tours](notes-first-tours.md): more notes on each box makes breaking the code
  apart worse, and margin notes fix that.
- Use the same margin later for [comment threads on code spans](code-span-annotations.md), so a thread on a line
  sits next to it in the same way.
