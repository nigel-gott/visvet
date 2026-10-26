---
kind: idea
status: exploring
description: Rule: each visual channel means one thing, always, so signals never fight over a box.
---
# Visual channels

Jagged edges for one thing and animation for another would turn into noise. Rule: **each visual channel means one thing, always.**

| Channel | Means |
|---|---|
| Position and nesting | structure |
| Arrows | dependencies |
| Border colour | changed since the base |
| Debuff icons | discrete facts (complex, long, untested) |
| Edge fill | familiarity ([fog of war](fog-of-war.md)) |
| Avatars in the corner | people ([ownership](ownership.md), [live agents](live-agents.md)) |
| Coloured stripes on the edge | open pull requests ([PR stripes](pr-stripes.md)) |
| Card shape behind the box | other dimensions ([stacked cards](stacked-cards.md)) |

Free ones, and a suggested use:

- **Fill tint: one "colour by" layer at a time**, picked like a map app's layers: churn, coverage, hotspot, risk. Never all at once.
- **Faded, desaturated, dashed: [dead](dead-code.md).** A state, not a score, meaning "delete me".
- **Animation:** only for brief events (selection, the AI typing), never a lasting property.

Debuffs stay the default: they stack without competing. [Plugins](plugins-as-programs.md) add data, never their own look, so this table stays the only place looks are decided.
