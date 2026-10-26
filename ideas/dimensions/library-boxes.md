---
kind: idea
description: The libraries the code uses most are boxes on the code map, with arrows from the code that uses them and a short summary.
---
# Library boxes

The important libraries the project uses (axum, tree-sitter, React, xyflow, ELK) appear as boxes on the code map, with arrows from the code that uses them. Click a library box to read what it is in a few lines.

- **Arrows are already half there:** the parser reads every `use` and `import`, and drops the ones pointing outside the repo. Keep them, and point them at a library box.
- **Only direct dependencies** (named in `Cargo.toml` or `package.json`), and only the important ones: ranked by how many boxes use them, so `serde` used everywhere may stay a quiet box while `elkjs`, used in one place, still shows.
- **The summary, [extracted](../extracted-not-drawn.md) first:** the package's own description (crates.io, npm), its version, and a docs link. Then one line on how *this* project uses it, from the [runtime model](../ai/runtime-model.md), cached per version.
- **Placed outside the code,** like boxes from other files: at the edge of the view, so they don't push the project's own boxes around.
- The full list, with licences and vulnerabilities, is the [dependencies dimension](dependencies-dimension.md). This note is about the few libraries you need to know to read the code, which also helps [learning tours](../guided-reading/learning-tours.md).
