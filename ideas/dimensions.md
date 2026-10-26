# Dimensions

Everything so far looks at a project in one dimension: **code**, its folders, files, types and functions. It's the closest view to how code is written, but not the only useful one.

Other dimensions show the same project another way, and you switch between them:

- **[Data](data-dimension.md):** schemas, tables and data models, and how they relate.
- **[Behaviour](behaviour-dimension.md):** what the system does, as black boxes and their behaviours, taken from the tests.
- More to find, e.g. runtime (processes and services) or the HTTP surface (see `issues/map-views/http-endpoints.md`).

A dimension can be projected into another: in the code dimension, a database shows up as its migration files or ORM classes.

[State machines](state-machines.md) aren't a dimension. They're a kind of picture that can appear in any of them.

Rule for every dimension: **visvet extracts it from the project by itself**, with tree-sitter and off-the-shelf tools, perhaps after a one-off setup. The AI shouldn't have to read the project and write the picture by hand. Where a project can't be read that way, see [methodology](methodology.md).

("Dimension" and "lens" mean the same thing here; naming comes later.)
