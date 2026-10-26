---
kind: idea
status: done
description: Tried 2026-10-26: claude.ai refuses to be framed, so visvet shows an artifact's HTML itself.
---
# Artifact embedding

**Experiment (2026-10-26):** published a tiny private test artifact and loaded it in an iframe on a localhost page.

- **Blocked.** claude.ai sends `frame-ancestors 'self'` plus two Chrome extensions, so only claude.ai (and Claude's extensions) may frame an artifact. Refused before anything loads, signed in or not.
- The content runs in an inner frame on `*.frame.claudeusercontent.com`, set up by claude.ai; not something visvet can point at.
- The docs' "embedded" viewers mean Claude's own surfaces.

**So:** an artifact is just HTML the AI wrote, and visvet has the source. visvet shows it in a [widget](../extending/widgets.md); claude.ai keeps the shared copy (link, comments, versions). Locally the runtime capabilities (`db`, comments, asking Claude) are missing; pages already work without them, and the [widget API](../extending/widget-api.md) can offer its own.
