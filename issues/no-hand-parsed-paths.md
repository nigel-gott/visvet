---
kind: issue
status: open
description: The UI still slices file paths as text; the Rust side now uses RepoPath and Path everywhere.
---
# No hand-parsed paths

CLAUDE.md forbids holding paths as strings and parsing them by hand. The Rust code now follows it. Left:

- `ui/src/model.ts::index`: `lastIndexOf('/')` for a path's name and folder. The browser has no path library, so this needs a small dependency (e.g. `pathe`) or one shared helper.
