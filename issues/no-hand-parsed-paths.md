---
kind: issue
status: open
description: Older code still parses file paths and URLs by hand; switch it to std::path::Path or a URL library.
---
# No hand-parsed paths

CLAUDE.md now forbids parsing paths by hand. These places still do:

- `src/cli/graph.rs::top_folder`: splits on `/`.
- `src/review/compare.rs::compare_box`: `ends_with(".md")` and `rsplit('.')` for the extension.
- `src/review/parse.rs`: `rsplit('.')` for the extension, twice.
- `src/review/dependencies.rs`: `trim_end_matches("/mod.rs")`, then splits on `/` and `.` to get a module name.
- `src/review/codegen.rs::ts_rs` and `src/review/parse/rust.rs`: slice up to `src/` to find the crate folder.
- `src/server.rs`: splits the URL on `://` and `/` to get the host name.
- `ui/src/model.ts::index`: `lastIndexOf('/')` for a path's name and folder.
