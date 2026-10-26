---
kind: idea
status: parked
description: Ways to change visvet itself, cheapest first: fork, settings, plugins, WebAssembly, scripting.
---
# Extension ladder

Agentic software can be customised endlessly; visvet should fit a codebase, person or organisation. Climb only as far as needed:

1. **Fork and edit**, with a skill that knows the codebase. Works today; the UI reloads itself when rebuilt.
2. **Settings in the repo:** which debuffs, thresholds, [dimensions](dimensions.md), in `.visvet/`.
3. **[Plugins as programs](plugins-as-programs.md).**
4. **WebAssembly plugins** (e.g. Extism), only once plugins are shared between strangers.
5. **A scripting language inside visvet** (Lua, Rhai, JavaScript), only if the rest falls short.

Not needed soon. Later, a registry of shared plugins and [widgets](widgets.md), perhaps simply as Claude Code plugins.
