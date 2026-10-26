# Activity

Who is working on what, as small avatars on the boxes (profile pictures, or initials).

## Sources

- **Agents right now:** sub-agents and other sessions, from the files they edit ([AI helpers](ai-helpers.md)).
- **Open pull requests:** from GitHub, mapped to the boxes their diffs touch. "Six PRs are changing this box" warns of conflicts before they happen.
- **Ownership:** from the git log.

## Ownership

Not "who created it". A score per person per box:

- Lines changed, weighted towards recent work (older work fades).
- Only people still active in the repo count fully.
- The top one or two are the owners. Prior art: code-maat's "main developer" analysis, `git-fame`.

Gives a debuff too: **knowledge at risk**, when a box's main owner has gone quiet or there's only one person who knows it (bus factor 1).

## How it looks

Avatars in a box's corner: a new [visual channel](node-signals.md), meaning only "people". Owners plain, active PRs and agents with a ring, so a glance tells "who knows this" from "who is changing it now".
