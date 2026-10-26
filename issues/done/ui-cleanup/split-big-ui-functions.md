---
kind: issue
status: done
description: Split the UI functions over complexity 15.
---
# Split the big UI functions

`visvet graph` scores them well over the 🌀 limit of 15:

- `ui/src/view.ts::mapView`: 42
- `ui/src/Card.tsx::Card`: 35
- `ui/src/main.tsx::App`: 32
- `ui/src/main.tsx::useNav`: 19
