---
kind: issue
status: open
description: A "builds" arrow from a package manifest to the file its program starts from, e.g. Cargo.toml to src/main.rs.
---
# Manifest builds entry point

A manifest says what gets built and where it starts, but the map doesn't show it: nothing links `Cargo.toml` to `src/main.rs`, or `ui/package.json` to the UI's first file. The arrow would answer "where does this program start?".

What to do:

- A new arrow kind, "builds", from a manifest to each entry point it names.
- Rust: `src/main.rs` and `src/lib.rs` by default, plus each `[[bin]]` / `[lib]` `path` in `Cargo.toml`.
- npm with Vite: `index.html`, and the script it loads (here `ui/src/main.tsx`); otherwise `main` / `module` / `exports` in `package.json`.
- Add "builds" to the legend in the UI, with its own line style.

The dependencies a manifest lists are a separate relationship: see `ideas/dimensions/library-boxes.md`.
