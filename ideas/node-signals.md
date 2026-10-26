# Node signals

What a box tells you at a glance about its health, beyond its structure. A complex, untested box that changes every week should look different from a well-tested box that hasn't moved in a year. Today that's the debuffs; this note is about what else to show and how, without the signals fighting each other.

## Signals worth having

- **Complexity, length, coverage:** have them.
- **Churn:** how often and how much the box has changed, from `git log --numstat` (per file, cheap) or `git log -L` (per function, slower).
- **Hotspot:** complexity × churn, the classic "where the bugs are" signal (from *Your Code as a Crime Scene*, tool: code-maat). Hotspot with low coverage is the riskiest code there is.
- **Dead code:** see below.
- **Familiarity:** see [fog of war](fog-of-war.md).
- **Change coupling:** boxes that always change in the same commits but have no arrow between them: a hidden dependency (code-maat's "temporal coupling"). Could be drawn as a dotted arrow.
- **Knowledge at risk:** see [activity](activity.md).
- **Smells you can count:** `unwrap`/`unsafe`/`any`, TODO and FIXME, how many members the outside uses (a wide public surface).
- **From traces:** slow spans and hot paths, once [flows](flows.md) exist.
- **External dependencies:** outdated versions or known vulnerabilities (`cargo audit`, `npm audit`).

## Dead code

Missing incoming arrows isn't enough: a dead cycle still has arrows, and visvet's arrows come from names, so some aren't real.

- **Off-the-shelf tools**, per language: rustc's `dead_code` lint (in a binary crate it covers `pub` items too), `cargo-udeps` for dependencies, `knip` for TypeScript, `vulture` for Python, `deadcode` for Go. Their output marks the boxes, as [dimensions](dimensions.md) require: extracted, not hand-written.
- **visvet's own reachability:** walk the dependency graph from the entry points (`main`, tests, exports). What isn't reached is suspect, cycles included.
- Always shown as "suspected", since both can be wrong (reflection, macros, code only the UI calls).

## Visual channels

The worry is real: jagged edges for one thing and animation for another would turn into noise. Rule: **each visual channel means one thing, always.** Channels already taken:

| Channel | Means |
|---|---|
| Position and nesting | structure |
| Arrows | dependencies |
| Border colour | changed since the base |
| Debuff icons | discrete facts (complex, long, untested) |
| Edge fill | familiarity ([fog of war](fog-of-war.md)) |
| Avatars in the corner | people ([activity](activity.md)) |

Free ones, and a suggested use:

- **Fill tint: one "colour by" layer at a time**, chosen from a switch like a map app's layers: churn, coverage, hotspot, risk. Continuous scores go here, never all at once, so they can't compete.
- **Faded, desaturated, dashed border: dead.** Dead is a state, not a score, and it means "delete me", so a ghost look fits.
- **Animation:** only for brief events (selection, the AI typing), never for a lasting property.

Debuffs stay the default: they stack without competing. The "colour by" switch is for when you're hunting for one thing.
