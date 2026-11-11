---
name: visvet
description: Review loop with the user through visvet. Use when the user says "visvet", talks about what they see in it, or after finishing a change they will review in visvet.
---

The user reviews your changes in visvet instead of reading raw code. visvet shows the change as boxes: folders contain files, and files contain boxes for their types (structs, classes and so on) with their members. Each box has a description, your review notes and the code diff. The user leaves comment threads on boxes, which you answer with `visvet reply`.

## Describe the code, in the code
Box descriptions come from doc comments, so keep them current as part of every change:
- Each source file starts with a one-line description: `//!` in Rust, a leading `//` or `/** */` comment in TS, `#` in TOML/YAML.
- Each type, and each non-obvious field, method or function, gets a one-line `///` or `/** */` doc comment that says what it is for.
- Keep them to one short sentence.

## Structure the code, not the map
The map's top levels are the code's own folders and files. A Rust file `x.rs` holds the files in folder `x/`, as in Rust. When a box looks tall or tangled, the code is usually doing too many jobs in one place: split it into files or folders by job. Never hide or rearrange things on the map to make it look tidy.

## Issues and other Markdown
Markdown files are boxes too. Front matter `kind: issue` or `kind: milestone` and `status: open` or `status: done` labels the box (other keys are ignored), and a folder takes its `README.md`'s. Every `path` or `file::box` named in backticks, or linked, gets a "links" arrow. Keep work to do in `issues/` (a folder per milestone, a file per issue), and when one is fixed, set `status: done` and move it to `issues/done/`, under its milestone's folder name.

## Dimensions
Besides the code map, a project can be seen as its concepts, architecture, data or behaviour: pages of diagrams, shown in place of the map by the top bar's switch. Make each a folder whose `README.md` says `kind: dimension` (name them `1-concepts/` and so on for order).
- The README is the front page: one well-organised overview diagram, most of the reading done there, no clicking needed.
- A bit of hierarchy: each part of the overview gets its own page in the folder with its detailed diagrams, linked from its node with `click node "page.md"` (`click Class href "page.md"` in a class diagram). The reader clicks in and uses the breadcrumbs to come back.
- ```mermaid diagrams: `flowchart`, `classDiagram`, `stateDiagram-v2`, `sequenceDiagram`. Draw C4 levels as flowcharts; Mermaid's `C4Context` overlaps its labels. In labels avoid `;` (it ends a statement) and nested `~generics~` (write `#lt;`/`#gt;`).
- Connect pages quietly: a `click` on a detail-page node can open another dimension's page (only seen on hover); and front matter `also:` lists the same thing elsewhere (other dimensions, the issue that builds it), shown as one thin "Also" line on both pages and as arrows on the code map:
  ```
  also:
    - ../4-behaviour/shard.md
    - ../../issues/m01-two-shards-tick/README.md
  ```
- Data shows what crosses each boundary (which messages, durable or not, packet layouts with `packet-beta`), not just types.
- On the code map, a Markdown link's title labels its arrow: `[Entity](entity.md "owns")`.
- Keep them true: once code exists, update a dimension in the same change that alters what it draws.

## Annotate your change for review
A note is a 📝 message from you in the box's thread: it joins the latest thread on the box, or starts one that needs no answer, and replaces your earlier note there. Keep few: only where the user should look, saying why it changed, what to check, or a risk. When code changes, rewrite or remove stale notes. Notes and replies render light markdown (paragraphs, `- ` lists, `**bold**`, backticks):
```bash
visvet explain "src/review.rs::build_review" "Diffs every file against base so removed boxes still show"
visvet explain "src/" "New: doc comments become box descriptions"
visvet explain "src/server.rs -> src/review.rs" "Server rebuilds the review on every request"
```
Symbol forms:
- `<file>`: a file
- `<file>::<Type>`: a type
- `<file>::<Type>::<member>`: a field or method
- `<file>::<fn>`: a free function
- `<file>::<head> <name>`: a top-level form of a Lisp-family file (`.lisp`, `.sexp`, `.scm`, `.clj`, `.el`), by its first two words, e.g. `"food/kitchen.lisp::recipe stew"` for `(recipe stew ...)`; just `<file>::<head>` when its second element is not a symbol, e.g. `(serves 4)`. Quote it: it has a space. A second form of the same name in a file ends in `#2`
- `<folder>/`: a folder, e.g. `src/types/`
- `<from> -> <to>`: an edge between any two of these

Notes are for review guidance. Descriptions belong in doc comments.

## Keep the graph clean
After a change, run `visvet graph`. It prints the map the user sees as text, worst first, each level by its own arrows, as the map draws them. An arrow is never a guess: it follows the file's imports and, in Rust, the module tree and `Cargo.toml`, so a name visvet can't trace (a method on a value, something a macro writes) has no arrow. These make the map look tangled:
- Under "package dependencies": a pair marked as declared but not used in code, or not declared. A package is a folder with a `Cargo.toml` or `package.json`.
- Cycles, reported per level: among packages, among the files of one package, among the types and functions of one file.
- Functions with high complexity, high fan-out (callees) or high fan-in (callers), and files most used by the rest of their package.
- Boxes with many arrows or outside peers under "zoom views": what the user sees zoomed into that box, counted as the map draws it (arrows between the boxes directly inside it; arrows to a "common" box, one that at least 5 and half of its siblings use, are hidden by default and counted apart).

Reduce them, or explain the trade-off with `visvet explain` on the box or arrow.

## Shared types
The UI's data types in `ui/src/contract.ts` are generated from `src/types.rs` by ts-rs. After changing `src/types.rs`, run `cargo test` to regenerate them; never edit `contract.ts` by hand.

## Keep changes reviewable
The user reviews at the folder, file and type level, then reads code only where needed. Prefer small, well-named code units and members with clear signatures. Never edit `.visvet/` files by hand; use `visvet reply` and `visvet explain` (the reviewed marks are the user's alone, see below). The one exception: you may delete a thread folder holding only your own note once it is stale, since `visvet explain` can't remove a note. Never touch the user's messages. Commit the thread files in `.visvet/threads/` along with your code.

## Reviewed marks are the user's
The user works through the repository by marking each file as reviewed in the UI. The marks are in `.visvet/reviewed` (one line per file: the git blob id of the content they reviewed, then the path).
- Never edit `.visvet/reviewed` by hand, and never mark or unmark anything yourself (`visvet reviewed <path>` is the user's command): a mark means the user read that file.
- Commit `.visvet/reviewed` and `.visvet/.gitattributes` along with your code when they have changed, like the thread files.
- To read progress: `visvet view` ends with it (e.g. "7/12 files reviewed, 1 changed since"), and `visvet reviewed --list` prints every file: `✓` reviewed, `~` changed since the user reviewed it, blank not yet.
- When you change a file the user has reviewed, its mark turns to "changed since reviewed" by itself, and the UI shows them the diff since the version they reviewed. That is intended: leave it for them to mark again.

## Follow and steer what the user sees
The user keeps visvet open beside this session.
- A hook runs `visvet view` on every user message. So when the user says "this", "here" or "that arrow", read the view first: the zoomed box, the selected symbol and the boxes on screen. If it is many seconds old, they may have looked away.
- To point at something, run `visvet show <symbol> --highlight <ids...>`. The UI zooms there, opens the symbol and outlines it and the given boxes or arrows ("<from> -> <to>"). The user's Back button returns them to where they were.
- Read mode (the top bar's Map | Read switch; a phone starts in it) shows the selected item's text over the whole screen instead of the map: a Markdown file rendered, code as its diff, a folder as its README.md or a list of what is inside. `visvet view` then gives the selected item and no boxes on screen, and `visvet show <symbol>` opens that item's text. Comments made by highlighting land on the file being read, quoting the text with its section or `line N`.

## Answer the user's comment threads
The user comments on boxes in visvet instead of in chat, so they don't interrupt your work. Each thread is open (waiting for you), working, question (waiting for them) or resolved.
- When you finish a task, a stop hook hands you every open thread and keeps you going. For each: do what it asks or answer it, then `visvet reply <id> "<what you did>" --resolve`. If you need their input, `visvet reply <id> "<your question>" --ask`. A reply without a flag marks it working.
- Threads stay on a box's id, so when you rename or move a box, move its threads too: `visvet move <id> <new box id>`. The stop hook also lists any thread whose box no longer exists (whoever renamed it) and keeps you going until each is moved. If the box was deleted, move the thread to what replaced it, or to its file.
- `visvet threads --all` lists every unresolved thread. The prompt hook shows only threads waiting for you, with only the messages since you last wrote; read `.visvet/threads/<id>/` for the rest when you need it.
- When you're idle with nothing open, run `visvet wait` in the background (run_in_background). It exits when the user leaves a comment, which wakes you to answer it.
- Answer a thread only in the thread. Don't repeat the answer in the chat: your chat message after thread work is one line at most (e.g. "Answered 2 threads."), or nothing. The user reads threads in the drawer.
- Keep replies short and easy to scan: one idea per line, a blank line between points, no walls of text. Pass line breaks in the text, e.g. `visvet reply 3 $'Renamed it.\n\nAlso updated the 3 callers.' --resolve`.

