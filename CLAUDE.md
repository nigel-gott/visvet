# visvet: notes for Claude

visvet is a multi-lens, visual way to review code changes at a higher level than the diff. It shows the change as a map of the code's own folders, files, types and functions, with debuffs flagging what is complex, long or untested. The user moves around the map and leaves comment threads on boxes; you answer them in the thread. Read `.claude/skills/visvet/SKILL.md` for the review loop.

## The user
- Reviews on a desktop with a mouse and a wide screen: the Claude desktop app's browser pane, or desktop Firefox.
- Doesn't read Rust or serde. Names and doc comments must explain themselves to a non-Rust reader.
- Reviews every line, so keep changes small, with as few lines as possible.
- Wants small "micro types" for domain values instead of bare strings, for example `GitRef`, not `String`.
- Always commit and push your work when a change is done, so nothing is lost.

## Run it
```bash
cd ui && npm run build && cd .. && cargo install --path . --locked
caffeinate -is visvet serve --no-open --port 7880
```
- Run the server in the background. Restart it after every change: `pkill -f "visvet serve --no-open --port 7880"`.
- A restart doesn't reload the page's JavaScript. Don't reload the user's tab yourself while they might be typing a comment: tell them to, and test in a separate tab.
- Keep visvet open in the desktop app's browser pane at http://127.0.0.1:7880.
- Check UI changes in the pane before you report them done.

## Checks
- `cargo test` also regenerates `ui/src/contract.ts` from the types in `src/types/`.
- `cargo clippy --all-targets`
- `cd ui && npx tsc --noEmit -p .`
- `visvet graph` prints coupling, cycles and complexity.
- `visvet coverage` runs the Rust tests under `cargo llvm-cov`; boxes then show a 🧪 low-coverage debuff. Rerun it after changing tests.

## Comment threads
See the skill. When you finish a task, the stop hook hands you open threads; answer each with `visvet reply`. When idle, keep `visvet wait` running in the background so new comments wake you.
