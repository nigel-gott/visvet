# Data dimension

The project seen as its data: what is stored, what shape it has, how the pieces relate. Part of [dimensions](dimensions.md).

What it shows:

- **Databases:** schemas and tables, foreign keys as arrows. Grouped like folders: database → schema → table.
- **Key-value or document stores**, if there are any.
- **Data models in the code**, and how they match the stored ones. In visvet, for example, the comment thread files: their shape should be visible, ideally as a JSON schema.

Where the line is: **a data model is a type that crosses a boundary**: stored, sent, or given a schema. Visible in code as `Serialize`/`Deserialize`, ORM derives, `#[ts(export)]`, types written to disk or returned from HTTP handlers. CLI-parsing structs cross no boundary, so they drop out. Tools like `schemars` can then show a type's JSON schema.

Like the rest of the map, it should be extracted by tools, not written by the AI.
