---
kind: idea
status: exploring
description: Boxes with custom insides (live components, media, small apps), first-class on the map.
---
# Widgets

Boxes with custom insides: a live table component, a video, audio, a small working app in a [tour](../guided-reading/tours.md) step. You play with it on the map, zoom it like any box, and comment on it. Not "everything is a canvas": ordinary boxes, some with custom content. visvet hosts them itself because [artifacts can't be embedded](../ai/artifact-embedding.md).

- **A folder of HTML/JS** by the AI or a person; shared ones committed in `.visvet/widgets/`.
- **A box kind:** the map already has kinds of box content (code, doc, plain file); a widget is one more, so threads, selection and arrows already work.
- **First-class on the map** ([added content](added-content.md)): next to the box it's about, or as its body ([live components](live-components.md)). Tours and [views](../guided-reading/views.md) can add them for a step.
- **Built-in kinds:** image, video, audio, Markdown, an artifact's HTML.
- Talks to visvet through the [widget API](widget-api.md).

Hard parts: **speed** (only widgets on screen and big enough run; others show a snapshot) and **drift** (anchored like threads). Security isn't a concern for personal use; each widget gets its own iframe only so its styles and crashes can't break the map.

Steps: a static HTML widget, then the API, then state and talking to the AI.
