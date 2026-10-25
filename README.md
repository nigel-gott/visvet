# visvet

A multi-lens, visual way to review code changes at a higher level than the diff. visvet shows the working tree's changes as a map of the code's own folders, files, types and functions, with debuffs flagging what is complex, long or untested. Each box has a description and the AI's review notes, and the code is one click away. You review by moving around the map and leaving comment threads on boxes; Claude sees what you have open and answers in the thread.

## Install

```bash
cd ui && npm install && npm run build && cd ..
cargo install --path . --locked
```

A release build embeds `ui/dist`, so build the UI first.

## Review a repo

```bash
visvet serve                # in the repo; diffs the working tree against HEAD
visvet serve --base main    # diff against another ref
```

The server prints its address and opens it in your browser. It has no login. It answers only requests addressed to `127.0.0.1`, `localhost` or the host of `--url` (its public address behind a proxy), so web pages can't read it through DNS rebinding. Anything that can reach the port can use it, so keep it on localhost.

## Review loop with Claude

`.claude/skills/visvet/SKILL.md` teaches Claude the loop:

| Command | Purpose |
|---|---|
| `visvet threads [--all]` | List your comment threads waiting for Claude |
| `visvet reply <id> "<text>" [--resolve \| --ask]` | Claude's answer to a thread |
| `visvet wait` | Wait for a new comment (Claude runs it while idle) |
| `visvet coverage` | Run the Rust tests under `cargo llvm-cov`, so boxes show low test coverage |
| `visvet view` | Print what you have open (a hook adds it to each message you send) |
| `visvet show <symbol> --highlight <ids...>` | Open a symbol in your UI and outline boxes or arrows |
| `visvet explain <symbol> "<note>"` | Add a review note to a box or edge |
| `visvet graph` | Print coupling, cycles, complexity and zoom tangles: the map as text |

Box descriptions come from doc comments in the code. Comment threads are kept in `.visvet/threads/`, one Markdown file per message, and are committed with the code: pushing and pulling shares them, so several people can review in the same threads. Everything else in `.visvet/` is local and ignored by git.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
