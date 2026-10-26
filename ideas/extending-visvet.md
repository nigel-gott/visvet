# Extending visvet

Agentic software can be customised endlessly. visvet should fit a codebase, a person or an organisation without everyone forking it. (Content inside the map is [widgets](widgets.md); this is about visvet's own behaviour.)

## A ladder, cheapest first

1. **Fork and edit**, with a skill that knows the codebase. Works today; the UI already reloads itself when rebuilt.
2. **Settings in the repo:** which debuffs, thresholds, which [dimensions](dimensions.md), in a config file in `.visvet/`.
3. **Plugins as programs:** a plugin is any executable that reads the project and prints data in visvet's own format: extra boxes, arrows, debuffs, annotations. Language doesn't matter, nothing to link into Rust; the same idea as git hooks or language servers. Most extension ideas (a dead code tool, ownership, a team's own rules) are just this.
4. **Sandboxed plugins:** WebAssembly (e.g. Extism), for plugins shared between people who don't trust each other's code.
5. **A scripting language inside visvet** (Lua, Rhai, or JavaScript): only if programs and WebAssembly fall short.

Rule: plugins add **data**, never pictures. visvet decides how data looks, so plugins can't fight over the screen ([node signals](node-signals.md)). Widgets are the way to add pictures.

## Registries

Later: a list of shared plugins and widgets, like Claude Code's plugin marketplaces. Possibly a Claude Code plugin is the way to ship visvet extensions at all.
