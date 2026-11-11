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
| `visvet coverage [-- <args>]` | Run the Rust tests under `cargo llvm-cov` (args passed on, e.g. to pick tests), so boxes show low test coverage |
| `visvet view` | Print what you have open and how far you are through marking files as reviewed (a hook adds it to each message you send) |
| `visvet reviewed [<path>...] [--undo] [--list]` | For you, not Claude: mark files (or every file under a folder) as reviewed, or unmark them; with no paths, or `--list`, print every file's state and the progress |
| `visvet show <symbol> --highlight <ids...>` | Open a symbol in your UI and outline boxes or arrows |
| `visvet explain <symbol> "<note>"` | Add a review note to a box or edge |
| `visvet graph` | Print the map as text, each level by its own arrows: package dependencies, cycles (among packages, files, and a file's types and functions), zoom views and complexity |

## Arrows

An arrow means what the source says, never a guess: a name is traced through the file's imports (`use`, `import`), its module (`crate::`, `super::`) and, for Rust, the crates its package's `Cargo.toml` lists. Anything that can't be traced that way (the standard library, outside crates, a method called on a value, a local variable) gets no arrow, so an arrow between two Cargo packages always follows a declared dependency. Something reached through a re-export in a crate the code doesn't depend on ends at the re-exporting file.

Each view draws the arrows of its own level: one per pair of the boxes it shows, standing for every use beneath them, with a count and thickness for how many. Hover an arrow for the uses beneath it; click it to list them all with file and line. The legend switches kinds on and off and says what is hidden: Markdown "links" inside code, and arrows to a "common" box that at least 5 and half of its siblings use.

Box descriptions come from doc comments in the code. Comment threads are kept in `.visvet/threads/`, one Markdown file per message, and are committed with the code: pushing and pulling shares them, so several people can review in the same threads. The reviewed marks (below) are committed too. Everything else in `.visvet/` is local and ignored by git.

## Mark files as reviewed

To work through a repository file by file, tick each file off once you have read it:

- On a file's or folder's row in the file tree, or on its box on the map, click the mark at the right: `○` not reviewed, `✓` reviewed. Or select it (or anything inside it) and press Alt+R. A folder shows how many of its files are reviewed, e.g. `7/12`, and its mark marks or unmarks every file under it, asking first above 10 files.
- A reviewed file is greyed in the tree and dimmed on the map, and so is a folder once every file in it is reviewed.
- A mark records the file's content when you made it. When the file changes afterwards it is not reviewed any more: it shows a `✓` in a dashed outline, "changed since you reviewed it", and a `Δ` beside it that opens the diff since the version you reviewed. Mark it again once you have read the change.
- Above the tree: the count of reviewed files, **Next ▸** (Alt+N) to go to the next file in the tree's order that isn't reviewed, and **Hide reviewed** to leave reviewed files and folders out of the tree and the map.
- From a terminal: `visvet reviewed src/server.rs src/types/`, `visvet reviewed --undo src/types/`, `visvet reviewed --list`. An open page follows along.

Every file the map shows counts; files git ignores are not on the map, so they don't.

The marks are in `.visvet/reviewed`, one line per file, sorted by path: the content's git blob id, then the path. Commit it with the code. A file that moves with the same content keeps its mark; a deleted file's mark is dropped the next time marks are written. `.visvet/.gitattributes` has git merge the file by keeping both sides' lines, so two people's marks never conflict (a file marked on either side with the content it has now is reviewed; a mark removed on one side next to a line the other side changed can come back).

## Lisp-family files

In a `.lisp`, `.sexp`, `.scm`, `.clj` or `.el` file, each top-level form is a box, named by its first two words (`recipe stew` for `(recipe stew ...)`; its id is `<file>::recipe stew`) and described by the `;` comment lines right above it. A top-level form that only groups definitions, i.e. whose head is followed by nothing but lists starting with two symbols, like `(private (recipe stew ...) (recipe broth ...))`, gives a box for each of those instead. visvet knows no one Lisp's words: all of this comes from the shape of the text.

A form with a name is a definition, and a file is a namespace named after the file. A symbol inside a form gets a "uses" arrow to the definition it names: a bare `stew` means the file's own `stew`, else the nearest one: in a file of the same folder, else of the folder around that, and so on out to the whole repository, so a copy of the definitions kept far away (say among the tests) doesn't make the name unclear. `kitchen/stew` means the one in the nearest `kitchen.lisp`. A name that could mean definitions in different files equally near gets no arrow (its card shows them all), and neither does one a file defines twice. Written as a form's head, `(stew ...)`, a name only means a definition that has a body, so `(mode quiet)` is not what `(quiet ...)` means.

In a Lisp-family file's code, a word the review knows something about is coloured, and a line above the code says what the two colours mean: one colour, drawn a little heavier, for a name the repository's own files define; another for a word its Markdown documents. A name that is defined is never also shown as documented. Click a word for a card saying what it is. The card opens under the word (above it when there is no room below, across the screen on a phone), scrolls inside itself when long, and the word stays marked while it is open; its ×, Escape, a second click on the word or a click anywhere else closes it. Its title line is the word and what kind of thing it is.

- A symbol that names a definition shows it: the file it is defined in and its form's head (`recipe` for `(recipe stew ...)`), its description, its first lines coloured as code, how many forms use it, and "Open definition" (Back returns). A name that files equally near define shows them all.
- Any other word shows where the repository's Markdown documents it, with nothing to configure: a table row whose first cell names the word (in backticks, alone or as the head of a whole form like `` `(simmer time :lid on)` ``, or in bold); or a heading, list item or paragraph that starts with the word that way. A piece cut out of a form, like `` `(simmer 40m` ``, or a line of other code quotes the word and documents nothing, and tours are not read for this. The card reads top to bottom: how the form is written, what it means (the cell after the first), the paragraph that leads up to the table, then each further cell under its column's heading, code cells such as an example coloured as code; short cells like "yes" go small at the foot beside the link to the page. Long text is cut after a few lines, with "Show more".
- Rows of one table that document the same word are the ways of writing it, e.g. `(heat low)`, `(heat high)`: the card lists them all with their meanings, under the paragraph that leads up to the table. When they differ in one word only, the form is written once with every value in its place, `(heat low | high)`, and the list is of the values. The row that fits the form in the code comes first, marked "written here" and open; a click opens any other.
- A word documented under several headings shows first the one whose heading names a form the word sits in; the rest are one line each under "Also documented as", and open on a click. When several files document a word, the file that documents the most of the Lisp files' words comes first.
- A `:keyword` shows the card of the form it is an argument of, with the keyword marked where the form is written.
- Under either, up to three places where Rust or TypeScript code handles the word as a string: a `match` arm like `"simmer" =>`, or a `case "simmer":`.

Numbers, strings and comments show nothing, and nor does a word that is neither defined nor documented.

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
