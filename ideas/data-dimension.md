# Data dimension

The project seen as its data: what is stored, what shape it has, how the pieces relate. Part of [dimensions](dimensions.md).

What it shows:

- **Databases:** schemas and tables, foreign keys as arrows. Grouped like folders: database → schema → table.
- **Key-value or document stores**, if there are any.
- **Data models in the code**, and how they match the stored ones. In visvet, for example, the comment thread files: their shape should be visible, ideally as a JSON schema.

Where the line is (open): every struct is not a data model. CLI-parsing structs aren't interesting here.

Like the rest of the map, it should be extracted by tools, not written by the AI.
