---
kind: idea
description: How often a box changes, and churn times complexity: the classic 'where the bugs are' signal.
---
# Churn and hotspots

- **Churn:** how often and how much a box changes, from `git log --numstat` (per file, cheap) or `git log -L` (per function, slower).
- **Hotspot:** complexity × churn, from *Your Code as a Crime Scene* (tool: code-maat). A hotspot with low coverage is the riskiest code there is.

Shown through the "colour by" [channel](visual-channels.md), not as more debuffs.
