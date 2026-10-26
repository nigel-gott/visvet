# Widgets

Boxes with custom insides: a live table component, a video, audio, a small working app in a [tour](tours.md) step. You play with it on the map, zoom it like any box, and leave comments on it. Not "everything is a canvas": ordinary boxes, some with custom content.

Why not artifacts: claude.ai refuses to be framed, see [Claude integration](claude-integration.md). So visvet hosts them itself.

## Shape

- **A widget is a folder of HTML/JS**, written by the AI or a person. Shared ones are committed in `.visvet/widgets/`; private ones stay out of git.
- **A box kind.** The map already has kinds of box content (code, doc, plain file). A widget is one more. Its threads, selection and arrows work like any box.
- **First-class on the map,** like any [added content](added-content.md): an agent adds a widget box where it helps, next to the box it's about, or as that box's body (a UI component showing itself live, see [live components](live-components.md)). Tours can add widgets for one step.
- **Built-in kinds** for the common cases: image, video, audio, Markdown, an artifact's HTML.

## The widget API

A widget talks to visvet only through messages to the page that holds it, through a small SDK:

- Read the map (boxes, arrows, the selection), and hear events (selection changed, tour step).
- Keep its own state, saved in `.visvet/`.
- Start a comment on an element inside it, so threads can point inside the widget.
- Post to a thread, to ask the AI something.
- Ask for a size, read the theme.

Copy the shape of the artifact runtime (`claude.use("db")` etc.): then a page written as an artifact runs unchanged in both places.

## Hard parts

- **Security:** not a concern while visvet is for personal use: the agent can already edit the code. Each widget still runs in its own iframe, so its styles and crashes can't break the map.
- **Speed:** many live iframes are heavy. Only widgets on screen and big enough run; the rest show a snapshot.
- **Drift:** a widget about a box can lose it when code moves, like stranded notes today. Same anchoring rules as threads.

## Possible steps

1. A static widget: an HTML file shown in a sandboxed box. No API.
2. The SDK: read the map, comment inside the widget.
3. State and talking to the AI.

The other kind of change, changing visvet itself, is [extending visvet](extending-visvet.md).
