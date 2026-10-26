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
- **Embedding:** see the experiment below.

## Experiment: an artifact inside visvet (2026-10-26)

Published a tiny private test artifact and loaded it in an iframe on a localhost page.

- **Blocked.** claude.ai sends `frame-ancestors 'self'` plus two Chrome extensions, so only claude.ai itself (and Claude's own extensions) may frame an artifact. The browser refuses before anything loads, signed in or not.
- The page content really runs in an inner frame on `*.frame.claudeusercontent.com`, set up by claude.ai; not something visvet can point at directly.
- The docs mention "embedded" viewers, but that means Claude's own surfaces, not third-party pages.

## So: render the artifact's HTML in visvet

An artifact is just an HTML page the AI wrote, and visvet has the source (the file on disk, or the Artifact tool's `read`). So:

- **Artifacts as nodes:** visvet shows the same HTML in its own sandboxed iframe, inside a box. Live and interactive, zoomable like any box, no click-through.
- **claude.ai keeps the shared copy:** the link for other people, comments, versions.
- **What's lost locally:** the runtime capabilities (`db`, `comments`, asking Claude). Pages are already written to work without them (they get `null`), so they degrade. visvet could later offer its own versions of some, e.g. comments that become visvet threads.
- **Desktop app:** in the browser pane, a click on a box's link can open the claude.ai version beside the map.

This also starts the bigger direction: the AI customising visvet itself, e.g. a tour step that is a small working app inside a box. Artifacts are the bridge; a canvas-like layer of visvet's own may come later.

[Overlays](overlays.md) stay in visvet, because they move the live map; artifacts are for content that stands on its own.
