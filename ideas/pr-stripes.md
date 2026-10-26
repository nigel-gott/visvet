---
kind: idea
status: exploring
description: Each open pull request gets a colour; boxes it touches get a stripe. Busy boxes look busy on purpose.
---
# Pull request stripes

Open PRs on the map. A PR is just another comparison: visvet already compares the working tree with a base, so a PR is its base compared with its head.

- **Every PR at once:** each open PR gets a colour; a box it touches gets a stripe of that colour on its edge. Six PRs, six stripes: busy on purpose.
- **Rolled up:** a closed folder shows the stripes of everything inside it.
- **Real clashes:** two PRs changing the same member get a stronger mark; `git merge-tree` can test-merge them.
- **One PR:** picked from a list in the top bar, the map highlights its changes as it does uncommitted edits, with its GitHub review comments.
- Stale PRs fade.

Its own [visual channel](visual-channels.md).
