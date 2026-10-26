---
kind: idea
description: The project seen as its data: databases, stores, and the data models in the code.
---
# Data dimension

What is stored, what shape it has, how the pieces relate. One of the [dimensions](dimensions.md).

- **Databases:** schemas and tables, foreign keys as arrows. Grouped like folders: database → schema → table.
- **Key-value or document stores**, if there are any.
- **Data models in the code**, and how they match the stored ones. In visvet, for example, the comment thread files: their shape should be visible, ideally as a JSON schema.

Which code types count is decided by [crossing a boundary](data-model-boundary.md). Extracted by tools ([rule](../extracted-not-drawn.md)), not written by the AI.
