# Claude integration

Use what the Claude apps already do instead of rebuilding it.

## What exists

- **Artifacts:** web pages Claude publishes to claude.ai, private until shared. They can keep a small shared database, take comment threads, ask Claude questions, and save new versions of themselves. A "canvas" is one kind: the **Design** type, artboards on a canvas. Others: Slides, Docs, Dashboard, Design System.
- **The desktop app's browser pane:** a real browser inside the app. Its draw and annotate buttons work on any page, visvet included, and send what you marked to the chat.
- **Claude Code hooks:** how visvet talks to the session today.

## Ideas

- **Drawing on the map already works.** Circle boxes in the browser pane and send it; the `visvet view` hook already tells the AI what's on screen, so the screenshot and the map state arrive together. Free; worth trying before building any drawing into visvet.
- **Artifacts for rich one-offs.** When a thread answer needs a diagram, a C4 picture, a statechart or a slide, the AI publishes an artifact and the thread links to it, with a preview card in the drawer. visvet doesn't need its own diagram editor.
- **Docs for design notes:** decision records and long explanations, edited together with comments.
- **A shareable snapshot:** publish a read-only map (the review JSON plus the UI) as an artifact, so a teammate without visvet can look and leave comments. The comments come back into visvet threads.
- **Embedding (unknown):** whether a claude.ai artifact loads inside visvet in an iframe depends on sign-in and frame headers. One small experiment answers it.

[Overlays](overlays.md) stay in visvet, because they move the live map; artifacts are for content that stands on its own.
