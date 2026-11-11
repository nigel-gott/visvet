---
kind: issue
status: open
description: Use language servers (rust-analyzer, tsserver) to find what code really uses, beyond what names and imports can say.
---
# Use language servers for exact links

visvet finds arrows itself: tree-sitter gives the text of names and imports, and `src/review/resolve.rs::Resolver` traces each name through the file's imports, its module and, for Rust, the crates its `Cargo.toml` lists. A name it can't trace gets no arrow, so wrong arrows are gone, but arrows are missing where only the compiler knows: a method called on a value, what a macro writes, tsconfig paths, trait methods. Each language's rules are copied by hand.

A language server (rust-analyzer for Rust, tsserver for TypeScript) runs the language's real rules, and can answer "where is this defined" and "what refers to this" exactly.

What to do:

- Start the project's language servers from `visvet serve` and ask them for definitions and references, through the standard Language Server Protocol.
- Keep tree-sitter for what it's good at (finding boxes, fast, works on the old version at the base commit, which a language server can't see); use the server only for arrows in the current version.
- Fall back to today's tracing of names and imports for languages without a server.

Costs: servers are slow to start and heavy (rust-analyzer indexes the whole crate), and each language needs its own. Related idea: `ideas/extending/languages-from-tag-queries.md`.
