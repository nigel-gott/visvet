---
kind: issue
status: done
description: A "generates" arrow from a package manifest to the lock file its package manager writes, e.g. Cargo.toml to Cargo.lock.
---
# Manifest generates lock file

`Cargo.toml` and `Cargo.lock` sit side by side on the map with nothing between them, yet Cargo writes the lock file from the manifest. That's the same relationship as ts-rs writing `ui/src/contract.ts`, which already gets a "generates" arrow.

What to do:

- A file-level detector next to the type-level ones in `src/review/codegen.rs`: a list of known pairs in the same folder, each giving a "generates" arrow from manifest to lock file.
- Pairs: `Cargo.toml` → `Cargo.lock`, `package.json` → `package-lock.json` (also `yarn.lock`, `pnpm-lock.yaml`), `pyproject.toml` → `uv.lock` / `poetry.lock`, `go.mod` → `go.sum`, `Gemfile` → `Gemfile.lock`.
- Only when both files exist.

No arrow from a lock file to the code: it only pins versions, and no code refers to it.
