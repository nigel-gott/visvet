# Dimensions

Everything so far looks at a project in one dimension: **code**, its folders, files, types and functions. It's the closest view to how code is written, but not the only useful one.

Other dimensions show the same project another way, and you switch between them:

- **[Data](data-dimension.md):** schemas, tables and data models, and how they relate.
- **[Behaviour](behaviour-dimension.md):** what the system does, as black boxes and their behaviours, taken from the tests.
- **[Concept](concept-dimension.md):** the ideas people use to explain the app, from the docs; drawn more freely.
- **[Architecture](architecture-dimension.md):** services, containers, people and teams (C4 levels 1 and 2).
- **Trust:** where untrusted input enters (HTTP, files, user text) and which [flows](flows.md) carry it to something risky (a shell, SQL, the file system). Perhaps just a kind of flow.
- **Time (unsure):** a slider through the git history; the map replays how the project grew.
- **Dependencies:** the external crates and npm packages, their versions, licences and vulnerabilities.
- More to find, e.g. the HTTP surface (see `issues/map-views/http-endpoints.md`).

## Between dimensions

The same thing exists in several dimensions: the concept "order", the `Order` ORM model, the `orders` table, the "place an order" behaviour. Moving between them must be easy, but boxes already carry a lot, so no more badges on them.

- **For now:** a quick way to switch dimension, keeping the selection where the other dimension has it. Then experiment.
- **Experiments:** a box drawn as a small stack of cards, which fans out to pick a dimension; or the whole map as stacked planes. See [stacked dimensions](stacked-dimensions.md).

A dimension can also be projected into another: in the code dimension, a database shows up as its migration files or ORM classes.

[State machines](state-machines.md) aren't a dimension. They're a kind of picture that can appear in any of them.

Rule for every dimension: **visvet extracts it from the project by itself**, with tree-sitter and off-the-shelf tools, perhaps after a one-off setup. The AI shouldn't have to read the project and write the picture by hand. Where a project can't be read that way, see [methodology](methodology.md).

("Dimension" and "lens" mean the same thing here; naming comes later.)
