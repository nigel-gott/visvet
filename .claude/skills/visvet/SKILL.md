---
name: visvet
description: Review loop with the user through visvet. Use when the user says "visvet", talks about what they see in it, or after finishing a change they will review in visvet.
---

The user reviews your changes in visvet instead of reading raw code. visvet shows the change as boxes: folders contain files, and files contain code units (types such as structs and classes) with their members. Each box has a description, your review notes and the code diff. The user leaves comment threads on boxes, which you answer with `visvet reply`.

## Describe the code, in the code
Box descriptions come from doc comments, so keep them current as part of every change:
- Each source file starts with a one-line description: `//!` in Rust, a leading `//` or `/** */` comment in TS, `#` in TOML/YAML.
- Each type, and each non-obvious field, method or function, gets a one-line `///` or `/** */` doc comment that says what it is for.
- Keep them to one short sentence.

## Structure the code, not the map
The map's top levels are the code's own folders and files. A Rust file `x.rs` holds the files in folder `x/`, as in Rust. When a box looks tall or tangled, the code is usually doing too many jobs in one place: split it into files or folders by job. Never hide or rearrange things on the map to make it look tidy.

## Issues and other Markdown
Markdown files are boxes too. Front matter `kind: issue` or `kind: milestone` and `status: open` or `status: done` labels the box (other keys are ignored), and a folder takes its `README.md`'s. Every `path` or `file::box` named in backticks, or linked, gets a "links" arrow. Keep work to do in `issues/` (a folder per milestone, a file per issue), and set `status: done` when it's fixed.

## Annotate your change for review
A note is a 📝 message from you in the box's thread: it joins the latest thread on the box, or starts one that needs no answer, and replaces your earlier note there. Keep few: only where the user should look, saying why it changed, what to check, or a risk. When code changes, rewrite or remove stale notes. Notes and replies render light markdown (paragraphs, `- ` lists, `**bold**`, backticks):
```bash
visvet explain "src/review.rs::build_review" "Diffs every file against base so removed units still show"
visvet explain "src/" "New: doc comments become box descriptions"
visvet explain "src/server.rs -> src/review.rs" "Server rebuilds the review on every request"
```
Symbol forms:
- `<file>`: a file
- `<file>::<Type>`: a type
- `<file>::<Type>::<member>`: a field or method
- `<file>::<fn>`: a free function
- `<folder>/`: a folder, e.g. `src/types/`
- `<from> -> <to>`: an edge between any two of these

Notes are for review guidance. Descriptions belong in doc comments.

## Keep the graph clean
After a change, run `visvet graph`. It prints the map the user sees as text, worst first. These make the map look tangled:
- Links between top folders, and cycles between files or folders.
- Functions with high complexity, high fan-out (callees) or high fan-in (callers).
- Boxes with many outside peers under "zoom views". When the user zooms into such a box, each peer is one more box and arrow.

Reduce them, or explain the trade-off with `visvet explain` on the box or arrow.

## Shared types
The UI's data types in `ui/src/contract.ts` are generated from `src/types.rs` by ts-rs. After changing `src/types.rs`, run `cargo test` to regenerate them; never edit `contract.ts` by hand.

## Keep changes reviewable
The user reviews at the folder, file and code unit level, then reads code only where needed. Prefer small, well-named code units and members with clear signatures. Never edit `.visvet/` files by hand; use `visvet reply` and `visvet explain`. Commit the thread files in `.visvet/threads/` along with your code.

## Follow and steer what the user sees
The user keeps visvet open beside this session.
- A hook runs `visvet view` on every user message. So when the user says "this", "here" or "that arrow", read the view first: the zoomed box, the selected symbol and the boxes on screen. If it is many seconds old, they may have looked away.
- To point at something, run `visvet show <symbol> --highlight <ids...>`. The UI zooms there, opens the symbol and outlines it and the given boxes or arrows ("<from> -> <to>"). The user's Back button returns them to where they were.

## Answer the user's comment threads
The user comments on boxes in visvet instead of in chat, so they don't interrupt your work. Each thread is open (waiting for you), working, question (waiting for them) or resolved.
- When you finish a task, a stop hook hands you every open thread and keeps you going. For each: do what it asks or answer it, then `visvet reply <id> "<what you did>" --resolve`. If you need their input, `visvet reply <id> "<your question>" --ask`. A reply without a flag marks it working.
- `visvet threads --all` lists every unresolved thread. The prompt hook shows only threads waiting for you, with only the messages since you last wrote; read `.visvet/threads/<id>/` for the rest when you need it.
- When you're idle with nothing open, run `visvet wait` in the background (run_in_background). It exits when the user leaves a comment, which wakes you to answer it.
- Keep replies short and easy to scan: one idea per line, a blank line between points, no walls of text. Pass line breaks in the text, e.g. `visvet reply 3 $'Renamed it.\n\nAlso updated the 3 callers.' --resolve`.

