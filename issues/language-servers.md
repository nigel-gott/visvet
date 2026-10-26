---
kind: issue
status: open
description: Use language servers (rust-analyzer, tsserver) to find what code really uses, instead of guessing from names and import text.
---
# Use language servers for exact links

visvet finds arrows by guessing: tree-sitter gives the text of names and imports, and visvet matches them itself. Each language's import rules are partly copied by hand: `src/review/parse/ts.rs::Ex` tries `.ts`, `.tsx` and `index.ts`; `src/review/parse/rust.rs::Ex` tries `x.rs` and `x/mod.rs`; `src/review/parse.rs::join` resolves `..`. Names that match by accident give wrong arrows; tsconfig paths, Rust re-exports and macros give missing ones.

A language server (rust-analyzer for Rust, tsserver for TypeScript) runs the language's real rules, and can answer "where is this defined" and "what refers to this" exactly.

What to do:

- Start the project's language servers from `visvet serve` and ask them for definitions and references, through the standard Language Server Protocol.
- Keep tree-sitter for what it's good at (finding boxes, fast, works on the old version at the base commit, which a language server can't see); use the server only for arrows in the current version.
- Fall back to today's guessing for languages without a server.

Costs: servers are slow to start and heavy (rust-analyzer indexes the whole crate), and each language needs its own. Related idea: `ideas/extending/languages-from-tag-queries.md`.
