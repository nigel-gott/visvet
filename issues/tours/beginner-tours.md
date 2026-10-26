---
kind: issue
status: open
description: One tour of the whole codebase for someone who knows JavaScript and Vue, teaching the Rust, TypeScript and React fundamentals as they come up.
---
# Beginner tours of visvet

One tour through the whole codebase (the user asked for one, 2026-10-26), in parts that teach the concepts as the code needs them:

- **Rust through visvet's backend:** modules, structs and enums, `match`, `Option`/`Result`/`?`, ownership and borrowing, `&str` vs `String`, traits and `derive`, closures and iterators, lifetimes.
- **The libraries:** clap, serde and ts-rs, axum and tokio (async), tree-sitter, similar, notify.
- **The frontend for a Vue developer:** components as functions, JSX vs templates, React hooks next to their Vue twins (`useState`/`ref`, `useMemo`/`computed`, `useEffect`/`watch`, `useContext`/`provide`-`inject`), @xyflow/react, Vite.
- **One request end to end:** git, parse, compare, dependencies, JSON, map.
