---
kind: issue
status: open
description: Split the UI functions still over complexity 15.
---
# Split the remaining big UI functions

With the first four split, `visvet graph` still scores these over the 🌀 limit of 15:

- `ui/src/model.ts::index`: 22
- `ui/src/Graph.tsx::flowEdges`: 20
- `ui/src/Graph.tsx::Graph`: 16
- `ui/src/Views.tsx::Outline`: 16
