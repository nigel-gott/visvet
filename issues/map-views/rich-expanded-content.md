---
kind: issue
status: open
description: Render expanded boxes richly: Markdown as formatted text, code with syntax highlighting, and clickable symbol links.
---
# Rich content in expanded boxes

Expanding a box (More) shows its text as plain diff lines today, in `ui/src/Views.tsx::DiffView`.

What to show instead:

- **Markdown files** rendered as formatted text: headings, lists, bold, code, links.
- **Code** with syntax highlighting for each language.
- **Symbol links that work.** A name in the code or the Markdown that is a box on the map (a type, a function, a file) is a link: clicking it goes to that box, the way the drawer's inbox does.

Keep the diff's added and removed line colours on top of the highlighting.
