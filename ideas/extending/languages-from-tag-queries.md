---
kind: idea
description: A new language as a tree-sitter grammar plus its tags.scm query file, not new Rust code.
---
# Languages from tag queries

Turn visvet on for Java and something isn't supported; an agent should add it in minutes.

- Most tree-sitter grammars ship a `tags.scm` query naming the language's definitions and references (it powers GitHub's code navigation). visvet could read those for any language, with per-language query files for the rest.
- Adding a language becomes adding a grammar and a query file, instead of Rust like `src/review/parse/rust.rs` and `src/review/parse/ts.rs` today.
- What it can't express can come from [plugins as programs](plugins-as-programs.md).
