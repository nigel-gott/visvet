---
kind: idea
description: A data model is a type that crosses a boundary: stored, sent, or given a schema.
---
# Data model boundary

Where the code ends and the [data dimension](data-dimension.md) begins: **a data model is a type that crosses a boundary**.

- Visible in code as `Serialize`/`Deserialize`, ORM derives, `#[ts(export)]`, types written to disk or returned from HTTP handlers.
- CLI-parsing structs cross no boundary, so they drop out.
- Tools like `schemars` can then show a type's JSON schema, keeping it [extracted](extracted-not-drawn.md).
