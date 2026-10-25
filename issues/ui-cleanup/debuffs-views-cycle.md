---
kind: issue
status: open
description: Debuffs.tsx and Views.tsx import each other.
---
# Break the Debuffs ↔ Views cycle

`ui/src/Debuffs.tsx` imports the context from `ui/src/Views.tsx`, which imports `ui/src/Debuffs.tsx` for its badges.
