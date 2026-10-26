---
kind: idea
description: How a widget talks to visvet: read the map, keep state, comment inside itself, ask the AI; shaped like the artifact runtime.
---
# Widget API

A [widget](widgets.md) talks to visvet only through messages to the page that holds it, via a small SDK:

- Read the map (boxes, arrows, the selection) and hear events (selection changed, tour step).
- Keep its own state in `.visvet/`.
- Start a comment on an element inside it, so threads can point inside the widget.
- Post to a thread to ask the AI.
- Ask for a size; read the theme.

Copy the shape of the artifact runtime (`claude.use("db")` etc.), so a page written as an [artifact](artifacts-for-one-offs.md) runs unchanged in both.
