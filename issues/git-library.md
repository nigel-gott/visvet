---
kind: issue
status: open
description: Read git through a Rust git library instead of running the git program and parsing its text.
---
# Use a git library instead of running git

`src/git.rs` runs the `git` program for each question and parses what it prints: the repository's top folder, the files now and at the base, which files changed, a file's text at the base, and the user's name. That means one process per changed file, NUL-separated text to split, and errors that arrive as stderr text.

A library answers the same questions with types:

- **gix** (gitoxide): pure Rust, so no C to build, and fast. Its API is large and still changing between releases; working-tree status (untracked files, `.gitignore`) is the newest part.
- **git2**: bindings to libgit2, the C library many tools use. Its API is small and stable, and status with untracked files is one call. It builds libgit2 from C source, which adds a C compiler to the build.

What to do:

- Pick one (git2 is the shorter change; gix keeps the build pure Rust).
- Replace `current_files`, `base_files`, `changed` and `show` with the library's index, tree and status calls, keeping their signatures so callers don't change.
- Keep the repository open once per review instead of starting a process per file.
- Check that untracked, ignored, deleted and renamed files show as they do today, with a test per case.
