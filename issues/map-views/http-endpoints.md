---
kind: issue
status: open
description: Show HTTP handlers as endpoints, with their method, path and path parameters.
---
# Show HTTP endpoints clearly

Handlers like `src/server.rs::reply` look like any other function on the map. Their route is only in the router in `src/server.rs::serve`, e.g. `.route("/api/threads/{id}", post(reply))`.

What to show instead:

- A header on the handler's box with its method and path, e.g. `POST /api/threads/{id}`, with path parameters like `{id}` picked out as variables.
- Maybe the endpoints drawn as "ports" on the owning module's box (`src/server.rs`), so the module's outside surface is visible at a glance.

How: a detector like the ones in `src/review/codegen.rs`, for axum's `.route(path, method(handler))` calls.
