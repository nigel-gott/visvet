---
kind: idea
status: exploring
description: The AI rates how important each file is to understand; with the fog of war that orders what to read next.
---
# Importance

Two numbers per file: how much of it you have explored (the [fog of war](fog-of-war.md)), and how important the AI thinks it is that you understand it. The gap between them is what to read next.

**Built, a first version** (`src/state/importance.rs`, `ui/src/ToRead.tsx`): a score from 0 to 100 per file with a one-line reason, set by the AI with `visvet importance`; a folder's score holds for the files under it. The file tree shows the score, and "To read" orders files by score times the share not explored.

Why a score and not tiers or a ranking: on a repository of thousands of files a "must read" tier is thousands of files with no order among them, and a full ranking has to be redone whenever a file is added. A score orders the files, and adding a file means rating one file.

A side effect that is wanted: a long file that mixes important and unimportant code sits high on the list for a long time, so the AI is pushed to split what matters from what doesn't, at file level.

Still only ideas:

- **Your override.** The AI rates its own work. A click to set a score yourself, which wins and stays.
- **Clumped scores.** An AI tends to give everything 70 to 90. Show the spread of scores, or have `visvet importance` complain when most files share a few values.
- **Unrated files.** The stop hook could hand the AI the files nothing rates, as it does orphaned threads. Not done yet: on a big repository it would stop every session until thousands of files are rated.
- **Files to split.** `visvet graph` could flag a long file with a high score as one to split.
- **Scores for boxes**, not only files: one function in a file may be all that matters.
- **With [tours](../guided-reading/tours.md).** A tour is an order for learning and often visits unimportant files for context, so it shouldn't set importance. But "a tour of what is left to read" could be made from the list, and tour order could break ties.
- **Decay.** What you explored a year ago you may not know now.
