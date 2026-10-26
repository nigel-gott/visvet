# Extending visvet

Agentic software can be customised endlessly. visvet should fit a codebase, a person or an organisation without everyone forking it. (Content inside the map is [widgets](widgets.md); this is about visvet's own behaviour.)

## A ladder, cheapest first

1. **Fork and edit**, with a skill that knows the codebase. Works today; the UI already reloads itself when rebuilt.
2. **Settings in the repo:** which debuffs, thresholds, which [dimensions](dimensions.md), in a config file in `.visvet/`.
3. **Plugins as programs:** a plugin is any executable that reads the project and prints data in visvet's own format: extra boxes, arrows, debuffs, annotations. Language doesn't matter, nothing to link into Rust; the same idea as git hooks or language servers. Most extension ideas (a dead code tool, ownership, a team's own rules) are just this.
4. **Sandboxed plugins:** WebAssembly (e.g. Extism), only once plugins are shared between strangers.
5. **A scripting language inside visvet** (Lua, Rhai, or JavaScript): only if programs and WebAssembly fall short.

Rule: plugins add **data**, never pictures. visvet decides how data looks, so plugins can't fight over the screen ([node signals](node-signals.md)). Widgets are the way to add pictures.

## New languages and new kinds of box

Turn visvet on for Java, and something isn't supported. The agent should add it in minutes, not hours.

- **Extraction from data, not code:** most tree-sitter grammars ship a `tags.scm` query file naming each language's definitions and references (it powers GitHub's code navigation). visvet could read those for any language, and per-language query files cover the rest. Adding a language becomes adding a grammar and a query file.
- **One format** for extractors and the AI: an extractor (built in, or a plugin program) prints boxes and arrows; an agent [adding to the map](added-content.md) writes the same thing.
- **New kinds of box:** a box kind with its own look is a [widget](widgets.md), so a new representation doesn't need a change to visvet's UI either.

## Registries

Later: a list of shared plugins and widgets, like Claude Code's plugin marketplaces. Possibly a Claude Code plugin is the way to ship visvet extensions at all.
