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

The same thing exists in several dimensions: the concept "thread", the `Thread` type, the threads folder on disk, the "reply to a thread" behaviour. Jumping between them should be one click. Drawing every cross-dimension link would swamp the map, so instead:

- **Chips on the selected box:** "also: concept *Thread* · behaviour *reply* · data *threads/*", in each dimension's colour. Click one to jump; the camera moves to the same thing in the other dimension.
- **Side by side:** two dimensions next to each other. Select in one and its counterparts highlight in the other (in charts this is called linked brushing). Lines between the two only for the selection.
- **A summary on each box:** a few small dots, one per dimension it's linked into. Shows at a glance which code has no concept behind it, or which concept has no code.

A dimension can also be projected into another: in the code dimension, a database shows up as its migration files or ORM classes.

[State machines](state-machines.md) aren't a dimension. They're a kind of picture that can appear in any of them.

Rule for every dimension: **visvet extracts it from the project by itself**, with tree-sitter and off-the-shelf tools, perhaps after a one-off setup. The AI shouldn't have to read the project and write the picture by hand. Where a project can't be read that way, see [methodology](methodology.md).

("Dimension" and "lens" mean the same thing here; naming comes later.)
