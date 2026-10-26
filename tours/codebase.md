---
kind: tour
description: The whole of visvet, from the command line to the map, teaching the Rust, TypeScript and React it uses as they come up. For an experienced engineer who knows JavaScript well and TypeScript and Vue somewhat.
---
# visvet from end to end

## What visvet is
`README.md` says what visvet does: it reads a git repository, compares the code now with the code at a git ref, and draws the result as a map of boxes. This tour follows one review through the code, in the order the work happens:

1. The command line starts a web server (Rust).
2. The browser asks the server for the review, and the server builds it: git, then parsing, then comparing, then the arrows between boxes.
3. The review goes to the browser as JSON, and the UI draws the map (TypeScript and React).
4. Comments on boxes are saved as files, so the AI can answer them.

Each step teaches the language features its code uses. The Rust steps explain Rust on its own terms; the UI steps compare React with Vue and build on the TypeScript you know. The purple note at the bottom says where the camera goes next and why.
route: Starting at the top of the repository, with what visvet is for.

### `## Review a repo`
`visvet serve` is the command this tour follows. `--base main` compares against the `main` branch instead of the last commit.

## Rust's package.json
`Cargo.toml` is the Rust package's manifest. Cargo is Rust's build tool and package manager: it fetches packages ("crates"), builds, tests and installs. `Cargo.lock` pins the exact versions.
route: Next door: the file that lists the Rust libraries visvet uses.

The crates you will meet on this tour: **clap** reads the command line, **tokio** runs async code, **axum** is the web server, **serde** turns types to and from JSON, **ts-rs** writes TypeScript copies of Rust types, **tree-sitter** parses code into syntax trees, **similar** makes line diffs, **notify** watches files, **anyhow** makes error handling short, and **rust-embed** puts the built UI inside the program.

### `edition = "2024"`
An edition is a version of the language's rules. Crates of different editions work together, so old code never breaks.

### `serde = { version = "1.0.229", features = ["derive"] }`
A "feature" switches on an optional part of a crate. Here, `derive` adds the `#[derive(Serialize)]` shortcut that you will see on almost every type.

## Where the program starts
`src/main.rs` is the first code that runs. Rust programs start at a function called `main`.
route: Into src, where the Rust program lives, starting at its entry point.

### `mod cli;`
`mod` declares a module. A file isn't a module until its parent declares it: `mod cli;` loads `src/cli.rs`. A module named like a folder (`src/review.rs`) holds the files in that folder (`src/review/`), which is why the map draws `review/` inside `review.rs`.

### `#[tokio::main]`
Your first macro. A macro is code that writes code: it runs inside the compiler, takes Rust source as input, and gives back new source, which is then compiled as if you had typed it. Rust has three kinds, and this tour shows each:

- **Attribute macros**, written `#[name]` on an item, like this one. They take the whole item and replace it.
- **Derive macros**, written `#[derive(Name)]` on a type. They read the type and add code beside it.
- **Function-like macros**, called with a `!`, like `format!(...)` or `vec![...]`.

Rust has no built-in async runtime; tokio supplies one. This attribute rewrites `main` into roughly `fn main() -> anyhow::Result<()> { tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap().block_on(async { cli::run().await }) }`: a plain `main` that starts the runtime and runs your async code on it. Not every `#[...]` is a macro: `#[cfg(test)]` and `#[allow(...)]` are built-in attributes, instructions the compiler follows itself.

### `async fn main() -> anyhow::Result<()> {`
`-> T` is the return type. `Result<T, E>` is either `Ok(value)` or `Err(error)`: Rust has no exceptions, so a function that can fail says so in its type. `()` is the "unit" type: the empty value, for a function with nothing to return. `anyhow::Result<()>` is a `Result` whose error can be any error.

### `cli::run().await`
`.await` comes after the call. The line has no `;` and no `return`: the last expression in a block is its value, so this is what `main` returns.

## The command line, as a type
`src/cli.rs::Cli` describes the command line as a struct, and clap writes the parser for it. A `struct` is a named group of fields, laid out in memory with no extra cost.
route: Over to src/cli.rs: what the program reads first is its command line.

### `#[derive(Parser)]`
A derive macro. At compile time, clap's `Parser` macro is handed the tokens of this struct: its name, each field, its type, and every attribute and doc comment on it. It writes a new block, `impl Parser for Cli { ... }`, with the code that reads the arguments into a `Cli`, and turns the `///` doc comments into the `--help` text. Unlike an attribute macro, a derive can only add code: the struct itself stays as written. The type is the schema: no separate description of the arguments.

Who provides what: `#[derive(...)]` itself is built into Rust: it means "run these derive macros on this type". `Parser` is the macro, and it comes from clap: the `derive` feature switched on in `Cargo.toml` adds it, and `use clap::{Args, Parser, Subcommand}` at the top of this file brings it into scope. `#[arg]` and `#[command]` below also come from clap, and `subcommand` and `flatten` are just words inside them.

### `#[arg(long, global = true, default_value = ".")]`
Not a macro: a "helper attribute". An attribute is always `#[name]` or `#[name(...)]`, and what goes in the brackets is free-form tokens, which only whoever reads the attribute gives meaning to. Here that is the `Parser` derive: as it walks each field, it reads that field's `#[arg]` and `#[command]` attributes as settings. Nothing else does, and without the derive the compiler would reject them.

`#[arg(...)]` sets up the field as one argument:

- `long`: given as `--repo` (the field's name), not by position.
- `global = true`: allowed after a subcommand too, e.g. `visvet tours --repo x`.
- `default_value = "."`: the current folder when not given.

### `#[command(subcommand)]`
`#[command(...)]` is the derive's other helper. `subcommand` says this field holds the subcommand: the first word, such as `tours` or `reply`, picks a variant of the `Cmd` enum, and the words after it fill that variant's fields. It is an `Option` because no subcommand is allowed: then visvet serves.

### `#[command(flatten)]`
`flatten` pulls the arguments of `ServeArgs`, a struct of its own, into this command as if written here, so `visvet --port 7880` works with no subcommand. `ServeArgs` has `#[derive(Args)]`: clap's derive for a group of arguments that is part of a command, not a whole command.

### `cmd: Option<Cmd>,`
Rust has no `null` or `undefined`. A value that may be missing is an `Option`: `Some(value)` or `None`. The compiler won't let you use it until you have handled `None`.

## Commands are an enum with data
`src/cli.rs::Cmd` lists every subcommand. A Rust `enum` is more than a list of names: each variant can carry its own fields. A value is exactly one variant, with that variant's fields, and the compiler checks that code handles every variant.
route: Same file: the subcommands the command line can hold.

### `Serve(ServeArgs),`
A variant that holds one value, written like a function call.

### `Explain {`
A variant with named fields, like a small struct of its own.

### `#[arg(value_parser = |s: &str| Ok::<_, String>(ThreadId(s.trim_start_matches('#').into())))]`
`|s: &str| ...` is a closure: an inline function that can use the variables around it. It turns the text `#k3f9a2` into a `ThreadId`. `::<_, String>` (the "turbofish") names a generic type that the compiler can't work out alone; `_` means "work this one out". `.into()` converts a value to the type the place needs, here `&str` to `String`.

## Running the chosen command
`src/cli.rs::run` reads the command line and runs the command. This is where you see Rust's two biggest ideas: ownership and `match`.
route: Same file: the function that picks what to run.

### `let top = git::git(&cli.repo, &["rev-parse", "--show-toplevel"])?;`
Two new things. `&` lends a value: `git` borrows `cli.repo` to read, and `cli` still owns it. The `?` at the end means "if this is an `Err`, return it from `run` now; else take the value out of the `Ok`".

### `match cli.cmd.unwrap_or(Cmd::Serve(cli.serve)) {`
`match` picks an arm by the value's shape, and must cover every variant, or the code doesn't compile. Each arm can take a variant apart and name its fields. `unwrap_or` gives the value inside an `Option`, or the default when it is `None`: no subcommand means serve.

### `Cmd::Serve(s) => server::serve(repo_root, s.base, s.addr, !s.no_open).await,`
Ownership: every value has one owner, and the value is freed when its owner ends. Most calls here lend with `&repo_root`. This one passes `repo_root` with no `&`, which moves it: the server now owns the path, and `run` can't use it again. The compiler checks this, which is how Rust frees memory without a garbage collector and without use-after-free bugs.

### `Cmd::Threads { stop_hook: true, .. } => threads::stop_hook(&repo_root),`
A pattern can test values, not only shapes: this arm matches only when `stop_hook` is true. `..` means "ignore the other fields". The arms are tried in order, so the next arm takes the rest.

### `let state = if resolve { ThreadState::Resolved } else if ask { ThreadState::Question } else { ThreadState::Working };`
`if` is an expression with a value, so its result can go straight into a variable.

## The server's shared state
`src/server.rs::App` is what every web request can read: the repository, the git ref to compare with, a channel for events, and the host names the server answers to.
route: Over to src/server.rs: `visvet serve` starts a web server.

### `#[derive(Clone)]`
axum gives each request handler its own copy of the state, so the state must be cloneable. Rust never copies a value behind your back: a copy is always an explicit `.clone()`, or a type marked `Copy`, such as a number.

### `tx: broadcast::Sender<RepoEvent>`
`<RepoEvent>` is a generic: the channel carries `RepoEvent`s. A broadcast channel sends each message to every listener: here, each browser tab.

## Starting the server
`src/server.rs::serve` sets up the routes, starts watching the files and listens for requests.
route: Same file: the function `run` handed the repository to.

### `pub async fn serve(repo_root: PathBuf, base: String, addr: Addr, open_browser: bool) -> anyhow::Result<()> {`
`pub` makes it visible outside its module; everything is private by default. `PathBuf` and `String` are owned values: `serve` keeps them. Their borrowed views are `&Path` and `&str`. A function that only reads text takes `&str`; one that keeps it takes `String`.

### `let (tx, _) = broadcast::channel(16);`
A pair of values taken apart into two names. `_` drops the receiver that comes with it; each browser subscribes its own later.

### `let _watcher = watch::watch(repo_root.clone(), move |e| _ = to_ui.send(e))?;`
`move` makes the closure own what it uses (`to_ui`), so it can run on another thread after this function's variables are gone. `_watcher` is never read, but keeping it in a variable keeps the watcher alive: when a value's owner ends, Rust drops it (here, at the end of `serve`), and dropping a watcher stops it. This "clean up when dropped" rule replaces `finally` and `close()` calls.

### `.route("/api/review", get(review))`
Each route maps a URL to a handler, and handlers are plain async functions. The UI calls these five routes.

### `.layer(middleware::from_fn_with_state(app.clone(), check_host))`
A layer wraps every route: each request goes through `check_host` first.

## Answering only known hosts
`src/server.rs::check_host` refuses requests addressed to any other host name, so a web page can't read visvet through DNS rebinding.
route: Same file: the check every request passes before its handler.

### `let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("").to_string();`
Each step works on an `Option`: `and_then` goes on only when there is a value, `ok()` turns a `Result` into an `Option`, and `unwrap_or` gives a default.

### `return (StatusCode::FORBIDDEN, format!("visvet: unknown host {host:?}; use 127.0.0.1 or the --url address")).into_response();`
`format!` is a function-like macro that builds a `String` from a template: `{host}` puts a value in, `{host:?}` puts in its debug form, with quotes. It is a macro, not a function, for two reasons: a Rust function takes a fixed number of arguments, and the macro reads the template at compile time, so a `{name}` that doesn't exist, or a value that can't print, is a compile error, not a runtime one. `into_response` comes from axum's `IntoResponse` trait: a set of methods a type can take on, even a type from another crate, such as this tuple.

## The request this tour follows
`src/server.rs::review` answers GET `/api/review`: it builds the review and sends it as JSON. The UI asks for it on load and after each change.
route: Same file: the handler that builds the review the map draws.

### `async fn review(State(app): State<App>) -> Res<Json<Review>> {`
axum reads the function's parameter types to know what to give it ("extractors"): `State<App>` asks for the shared state. `State(app)` is a pattern: it takes the value out of its wrapper right in the parameter list. Returning `Json<Review>` tells axum to send the review as JSON, which serde writes.

### `let m = tokio::task::spawn_blocking(move || -> anyhow::Result<Review> {`
Building a review reads and parses every file, which takes a while and doesn't await. tokio runs many requests on a few threads, so slow, blocking work goes to a thread of its own, where it holds up no other request.

### `m.await.map_err(err)?.map(Json).map_err(err)`
Two `Result`s, one inside the other: the thread may have crashed (the outer one), and the build may have failed (the inner one). `map_err(err)` turns each error into a 500 response.

## Telling the browser that something changed
`src/server.rs::events` keeps a connection open and sends an event whenever the files change, using server-sent events, so the map stays live.
route: Same file: how the browser hears about changes.

### `-> Sse<impl Stream<Item = Result<Event, Infallible>>> {`
`impl Stream<...>` means "some type that is a stream of these": the real type is long, and the caller only needs to know it is a stream. `Infallible` is an error type that can't happen.

### `let pushes = tokio_stream::once(Ok(RepoEvent::Changed)).chain(BroadcastStream::new(app.tx.subscribe()));`
One `change` event straight away, then every event the watcher sends.

## Tests live next to the code
`src/server/watch.rs` is the file watcher, in `src/server/`, the folder of server.rs's own modules. First, how it ends: with its tests. Rust puts unit tests in the same file as the code, in a module that only test builds compile.
route: Same view: the file watcher's file, and the tests at its end.

### `#[cfg(test)]`
Compile what follows only for `cargo test`. visvet's map leaves test modules out, so the map shows only the real code.

### `use super::*;`
`super` is the module around this one: the tests can use everything in the file, private items too.

### `assert!(counts("src/main.rs") && counts(".visvet/threads/k3f9a2/1-ann.md") && counts(".git/HEAD"));`
`assert!` fails the test when its condition is false. Being a macro, it sees the condition's source text, so a failure prints the expression itself, not just "false". `assert_eq!(a, b)`, used in other tests, prints both values.

## Watching the files
`src/server/watch.rs::watch` uses the notify crate to hear about file changes, and collects each burst into one event.
route: Into watch.rs: the function that does the watching.

### `pub fn watch(repo_root: PathBuf, on: impl Fn(RepoEvent) + Send + 'static) -> notify::Result<notify::RecommendedWatcher> {`
`on` is any function that takes a `RepoEvent`, with two promises: `Send` means it can move to another thread, and `'static` means it borrows nothing that could end first. With them, the compiler proves no other thread can see half-changed data.

### `std::thread::spawn(move || {`
A real operating-system thread, not an async task: it spends its life waiting for file events.

### `while let Ok(first) = raw_rx.recv() {`
`while let` loops for as long as the pattern matches: until the channel closes and `recv` gives an `Err`.

### `if paths.contains(&show) && let Ok(json) = std::fs::read_to_string(&show) {`
`let` in a condition runs the block only if the file could be read, and names its text `json`.

## Building the review
`src/review.rs::build_review` is the heart of visvet. It lists the files in the working tree and at the base, reads both versions of each, compares them, and finds the arrows between the boxes.
route: Over to src/review.rs, which the request handler called to build the review.

### `let cur: HashSet<RepoPath> = git::current_files(repo_root)?.into_iter().collect();`
`collect` builds whatever collection the variable's type asks for: here a `HashSet`. Rust infers types backwards from where a value goes, so one `collect` can build a list, a set or a map.

### `for f in cur.union(&old).filter(|f| !visvet_dir::holds(&f.0)).collect::<BTreeSet<_>>() {`
Every file in either version, except visvet's own folder. A `BTreeSet` is a set kept in sorted order, so the files are read in path order. `f.0` is the first field of a struct with unnamed fields: `RepoPath` wraps a `PathBuf`.

### `let new = cur.contains(f).then(|| std::fs::read(repo_root.join(&f.0)).ok()).flatten();`
`then` turns a `bool` into an `Option`: `Some(...)` when true, `None` when false. So `new` is the file's bytes, or `None` when the file is gone now.

### `Ok(Review { compared_against: GitRef(base.into()), boxes, dependencies, tours, ..Default::default() })`
`boxes` alone means `boxes: boxes`. `..Default::default()` fills every other field with its default.

## Asking git
`src/git.rs::git` runs a git command and returns what it printed. visvet calls the `git` program instead of using a git library: what you see is what `git` says.
route: Over to src/git.rs, which build_review asked for the lists of files.

### `pub fn git(repo_root: &Path, args: &[&str]) -> anyhow::Result<Vec<u8>> {`
`&[&str]` is a slice: a borrowed view of a list, of any length, here of borrowed strings. `Vec<u8>` is a growable list of bytes, because git's output may not be valid text.

### `let out = Command::new("git").arg("-C").arg(repo_root).args(args).output()?;`
`Command::new` uses `::` because `new` belongs to the type, like a static method; `.arg` uses `.` because it works on a value. Each call returns the builder, so they chain.

### `anyhow::ensure!(out.status.success(), "git {}: {}", args.join(" "), err.trim());`
If git failed, return an error built from this message and git's own error text. This is something only a macro can do: it expands to `if !condition { return Err(anyhow!(...)) }` right here, so its `return` leaves `git` itself. A function could only return from its own body.

## Iterators
`src/git.rs::paths` splits git's output into paths. It is one chain of iterator calls, which you will see everywhere in Rust.
route: Same file: turning git's output into paths.

### `String::from_utf8_lossy(&out).split('\0').filter(|p| !p.is_empty()).map(|p| RepoPath(p.into())).collect()`
Iterators are lazy: nothing runs until `collect` asks for the result, and then the compiler joins the steps into one loop, as fast as a hand-written one. `'\0'` is a `char`, written in single quotes, unlike a string.

## Comparing a file's two versions
`src/review/compare.rs::compare_file` parses both versions of a file into boxes, pairs the old and new boxes by name, and compares each pair. That is how every box knows whether it was added, changed, removed or is the same.
route: Back in src/review, into the first step of building: comparing each file.

### `pub fn compare_file(file: &RepoPath, new: Option<&[u8]>, old: Option<&[u8]>) -> Vec<Parsed> {`
`Option<&[u8]>`: a file's bytes, borrowed, or `None` when that version doesn't exist (the file was added or deleted).

### `let parsed = |b: Option<&[u8]>| b.map_or(vec![], |b| parse(file, &std::str::from_utf8(b).unwrap_or("").replace("\r\n", "\n")));`
A closure kept in a variable, which uses `file` from around it. `map_or` gives `vec![]` (an empty list) for `None`, else parses the text. `vec![a, b, c]` is a function-like macro that builds a `Vec` holding those items; it takes square brackets by convention, since any of `()`, `[]` or `{}` may wrap a macro's input.

### `let (now, before) = (parsed(new), (new != old).then(|| parsed(old)));`
An unchanged file isn't parsed twice: the old version is parsed only when the bytes differ.

## Generics and lifetimes
`src/review/compare.rs::pair` pairs the boxes of two versions by name. Its signature shows lifetimes.
route: Same file: how old and new boxes find each other.

### `fn pair<'a, T>(new: &'a [T], old: &'a [T], key: fn(&T) -> &str) -> Vec<(Option<&'a T>, Option<&'a T>)> {`
`T` is a generic type. `'a` is a lifetime: a name for "as long as `new` and `old` exist". The result holds references into those two lists, not copies, and `'a` tells the compiler that the result can't outlive them. Get it wrong and the code doesn't compile, so there are no dangling pointers. `fn(&T) -> &str` is the type of a plain function that gives an item's name.

### `let mut v: Vec<_> = new.iter().map(|n| (Some(n), oi.get(key(n)).copied())).collect();`
`mut`: variables can't change unless you say so. `.copied()` turns an `Option<&&T>` into an `Option<&T>`.

## Matching on more than one value
`src/review/compare.rs::status` says how a box changed, from its two versions.
route: Same file: added, removed, changed or the same.

### `fn status<T: PartialEq>(new: Option<T>, old: Option<T>) -> ChangeStatus {`
`T: PartialEq` is a trait bound: `T` can be any type that can be compared with `==`.

### `(n, o) if n == o => ChangeStatus::Same,`
The `match` takes a pair apart. `if n == o` is a guard: the arm matches only when it is also true.

## The line diff
`src/review/compare.rs::diff` makes the line-by-line diff that the map shows in each box, with the `similar` crate.
route: Same file: the lines of each box's diff.

### `TextDiff::from_slices(&o, &n).iter_all_changes().map(|c| {`
`similar` compares the two lists of lines and says, for each line, whether it is the same, added or removed.

### `ChangeTag::Equal => (DiffLineKind::Context, nl as usize + c.new_index().unwrap()),`
`as usize` converts a number type; Rust never converts numbers by itself. `.unwrap()` takes the value out of an `Option` and crashes the program if there is none: used only where there must be one.

## Parsing code with tree-sitter
`src/review/parse.rs::parse` turns one version of a file into boxes: the file itself, then each type in it. tree-sitter is the parser many code editors use; it reads Rust and TypeScript into syntax trees, and still gives a tree when the code has errors.
route: Into src/review/parse.rs: before comparing, each version is parsed.

### `let Some(grammar) = grammar(language) else { return parser.boxes };`
`let ... else`: take the value out of the `Some`, or else run the block, which must leave the function. Here a file that isn't Rust or TypeScript keeps only its file box.

### `let mut p = Parser::new();`
A tree-sitter parser, set to the file's language on the next line.

### `for n in tree.root_node().named_children(&mut tree.walk()) {`
Each top-level item of the file. `&mut` lends a value that the borrower may change: here a cursor that tree-sitter moves through the tree. While a `&mut` loan lasts, nothing else may use the value, so two parts of the code can't change it at once.

## What parsing gives
`src/review/parse.rs::ParsedBox` is one box as parsed from one version: its name, kind, text, doc, members and the names it mentions.
route: Same file: the shape of a parsed box.

### `#[derive(Default, Debug)]`
`Default` gives the type an empty value (empty strings, empty lists), so `..Default::default()` can fill the fields you don't set. `Debug` lets you print it with `{:?}`.

### `pub uses: Vec<Vec<RepoPath>>,`
A list of lists: for each import, the files it may mean, best first.

## A struct that borrows
`src/review/parse/walk.rs::FileParser` walks one file's syntax tree and collects its boxes.
route: Into src/review/parse: the walker that does the parsing.

### `pub(super) struct FileParser<'a> {`
`pub(super)`: visible to the module around this one, and no further. `<'a>`: the struct holds a reference, so it carries a lifetime: a `FileParser` can't outlive the source text it reads.

### `pub(super) src: &'a str,`
The file's text, borrowed, not copied. Each box's text is a slice of it until it is stored.

## Methods
`src/review/parse/walk.rs::FileParser::item` handles one top-level item of a file. Methods live in an `impl` block, apart from the struct's fields.
route: Same type: the method that sorts each item of a file.

### `pub(super) fn item(&mut self, n: Node) {`
`&mut self` is a method that may change the value it is called on (here, add boxes). A method that only reads takes `&self`, and the compiler holds it to that.

### `"function_item" | "function_declaration" => {`
A `match` on text. `|` matches either: one name from the Rust grammar, one from TypeScript's.

### `k => type_kind(k).into_iter().for_each(|kind| self.type_item(n, kind)),`
The last arm names whatever is left `k`. An `Option` can be iterated, with zero or one items, so this calls `type_item` only for a node that declares a type.

## One type, methods in many files
`src/review/parse/rust.rs::FileParser::rust_use` is one of the methods for what only Rust has: `use` lines and `impl` blocks. They are more methods on the same `FileParser`, in another file.
route: Same folder: more of FileParser's methods, in the file for Rust.

### `pub(super) fn rust_use(&mut self, use_item: Node) {`
This method sits in an `impl FileParser<'_> { ... }` block. A type can have many `impl` blocks, in any file of its crate, so each job gets its own file. `'_` means "some lifetime; the name doesn't matter here". visvet draws the block as an "impl" box, since its type is declared in another file.

### `let crate_src = self.path.src_folder().unwrap_or(self.path.folder());`
`src_folder` is a method on `RepoPath`, visvet's own type for a file path. You'll see it soon.

## Finding the arrows
`src/review/dependencies.rs::find_dependencies` turns the names each box mentions (types, calls, imports) into arrows to the boxes they mean.
route: Back out in src/review: once every file is compared, the arrows between boxes.

### `let (mut edges, mut links, mut implements) = (vec![], BTreeSet::new(), vec![]);`
Three empty collections. Their item types aren't written: the compiler works them out from what is pushed into them later.

### `for (names, kind) in [(&p.types, DependencyKind::Has), (&p.traits, DependencyKind::Implements)] {`
A loop over a small fixed array of pairs, taking each pair apart, so one loop body handles both kinds of arrow.

### `if let BoxContent::Code { implements, .. } = &mut p.map_box.content {`
`if let` is a `match` with one arm: if the box holds code, lend its `implements` field to change. `*implements = traits;` then writes through the loan; `*` means "the value this points at".

## An index that borrows
`src/review/dependencies.rs::Index` looks up types and functions by name. It holds references into the parsed boxes, so building it copies nothing.
route: Same file: looking up what a name means.

### `struct Index<'a> { types: HashMap<&'a str, Vec<&'a MapBox>>, fns: HashMap<&'a str, Vec<(&'a MapBox, &'a Member)>> }`
A `HashMap` is a hash table of keys to values. Every key and value here is a reference with lifetime `'a`: the index lives no longer than the boxes it points into.

### `ix.types.entry(&o.name).or_default().push(o);`
The "entry" API: find the list for this name, or put in an empty one, then push, with one lookup.

## Patterns on lists
`src/review/dependencies.rs::pick` chooses what a name means: the one match in the same box, else in the same file, else anywhere. Two matches is unclear, so it draws no arrow.
route: Same file: choosing between boxes with the same name.

### `[&(_, to)] => Some(to),`
A pattern on a slice: it matches a list of exactly one item, and names that item's second part `to`. Any other length goes to `_ => None`.

## Code generators
`src/review/codegen.rs` knows which files a tool writes from others: the TypeScript ts-rs writes from Rust types, and the lock file a package manager writes from its manifest. These become "generates" arrows on the map.
view: zoomed
route: Same folder: arrows that parsing alone can't see.

### `type Detector = fn(file: &RepoPath, text: &str) -> Option<RepoPath>;`
A type alias for a function type. Adding a generator means writing one function of this type.

### `const DETECTORS: &[Detector] = &[ts_rs];`
A `const` is fixed when the program is compiled. This one is a list of functions.

### `const LOCK_FILES: &[(&str, &[&str])] = &[`
A fixed table of pairs: a manifest's name, and its lock files.

## The contract between Rust and TypeScript
`src/types.rs` holds every type the server sends to the UI: the "contract". `cargo test` has ts-rs write a TypeScript copy of each into `ui/src/contract.ts`, so the two sides can't drift apart.
view: zoomed
route: Over to src/types.rs: the types the review is made of.

### `macro_rules! string_methods {`
A macro of visvet's own, so you can see how one is made. `macro_rules!` defines a "declarative" macro: a list of rules, each a pattern for the input and a template for the output, like a `match` on source code. This one gives each string wrapper type `.as_str()` and printing, without writing them out each time. It is used at the end of `src/types/ids.rs`: `string_methods!(BoxId, MemberId, MapId);`.

### `($($name:ident),*) => {$(`
The rule's pattern, then the start of its template. `$name:ident` matches one identifier (a name such as `BoxId`) and calls it `$name`. `$( ... ),*` means "the part inside, repeated any number of times, separated by commas". In the template, `$( ... )*` repeats its part once per match. So `string_methods!(BoxId, MapId)` writes the two `impl` blocks below twice: once with `$name` as `BoxId`, once as `MapId`.

### `impl $name {`
The template: plain Rust with `$name` filled in. The compiler expands it before checking types, so a mistake in it is reported where the macro is used. Declarative macros only rearrange tokens; the derive and attribute macros you have seen are "procedural": Rust programs, in their own crates, that run in the compiler. To see what any macro writes, `cargo expand` (a separate tool) prints the code after expansion.

### `pub use annotations::*;`
Passes on everything in the `annotations` module, so other code can write `crate::types::Thread` and needn't know the file it is in.

## Micro types
`src/types/ids.rs::RepoPath` is a file's path in the repository. It wraps a `PathBuf`, so the compiler won't let you pass a box id or any other text where a path should go.
route: Into src/types: first, the small types that say where things are.

### `pub struct RepoPath(pub PathBuf);`
A struct with one unnamed field, read as `.0`. In memory it is just the `PathBuf`, so the type costs nothing at runtime.

### `fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {`
This method comes from `impl std::fmt::Display for RepoPath`. Implementing the `Display` trait says how the type prints as text: it lets `format!("{file}")` print a path.

### `pub fn as_str(&self) -> &str {`
Returns a borrowed view of the path as text, which lives as long as the `RepoPath` does. No text is copied.

### `self.0.extension().is_some_and(|e| e == "rs")`
Paths are taken apart with the standard library (`extension`, `parent`, `file_name`), never by splitting text on `/` or `.`.

## What a box is
`src/types/boxes.rs::BoxKind` lists what a box can be: a struct, an enum, a class, a whole file, and so on.
route: Over to boxes.rs: the boxes on the map.

### `#[serde(rename_all = "lowercase")]`
In JSON, each variant is a lowercase string, e.g. `"struct"`. In TypeScript, the type is a union of those strings.

### `pub fn label(self) -> &'static str {`
`'static` is the lifetime of something that lasts as long as the program, such as a string written in the code. So the caller can keep the label for as long as it likes.

## One box on the map
`src/types/boxes.rs::MapBox` is one box: its id, name, file, language, lines, doc, change status, diff, and what it holds.
route: Same file: the box itself.

### `pub fn kind(&self) -> BoxKind {`
A method that reads a box and gives its kind, written with a `match` on the box's content.

### `pub fn members(&self) -> &[Member] {`
Returns a borrowed slice of the box's own list, or `&[]`, an empty slice, for a box with no code.

## An enum becomes a union
`src/types/boxes.rs::BoxContent` is what a box holds: code, a Markdown document, or a plain file. Each variant has its own fields.
route: Same file: what a box holds, by what it is.

### `#[serde(tag = "type", rename_all = "lowercase")]`
In JSON each variant becomes an object with a `type` field, e.g. `{ "type": "code", "kind": "struct", "members": [...] }`. ts-rs writes the matching TypeScript union, so the UI tests `content.type === 'code'` and TypeScript then knows which fields exist.

### `Doc { labels: DocLabels },`
A variant with one named field: a document's front matter labels.

## Comment threads, as data
`src/types/annotations.rs::ThreadMessage` is one message in a comment thread, saved as one Markdown file in `.visvet/threads/`.
route: Over to annotations.rs: the review work that isn't code.

### `#[ts(type = "number")]`
A `u64` (an unsigned 64-bit number) would become a TypeScript `bigint`, since a JavaScript `number` loses precision above 2⁵³. A time in milliseconds never gets that big, so the copy says `number`.

### `pub author: Author,`
`Author` is an enum, `User` or `Ai`, which is `"user"` or `"ai"` in JSON.

## The whole review
`src/types/review.rs::Review` is the top of the contract: everything GET `/api/review` returns. Its first parts are rebuilt from git on each request; its threads come from `.visvet/threads/`.
route: Over to review.rs: the one value the request handler sends.

### `#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]`
Six derives on one type, each adding its own `impl` block. `Clone`, `Debug` and `Default` are built into Rust; `Serialize` and `Deserialize` come from serde, `TS` from ts-rs. serde's derive writes code that visits each field by name, which is how JSON can be written without looking the fields up at runtime. ts-rs's writes a function that prints this type's TypeScript, and `cargo test` runs it. The JSON and the TypeScript come from the same type, so they always agree.

### `#[ts(export, export_to = "../ui/src/contract.ts")]`
A helper attribute that the `TS` derive reads, as `#[serde(...)]` lines are for serde's. Where the TypeScript copy goes. visvet reads this line too, to draw a "generates" arrow from each type to its copy.

## Saving threads safely
`src/state/store.rs::update` changes the comment threads: it locks visvet's folder, loads the threads, runs the change, and saves them.
route: Over to src/state: how comments are saved, so the AI can read them.

### `fn update<R>(repo_root: &Path, f: impl FnOnce(&mut ReviewAnnotations) -> Result<R>) -> Result<R> {`
`f` is a function that may be called once, gets the threads to change, and returns any type `R`, which `update` passes back. A callback, typed in full.

### `lock.lock()?;`
An exclusive file lock, so the UI and the AI never save at once. There is no unlock call: the lock is freed when `lock` is dropped, at the end of the function, even if a `?` returns early.

### `let r = f(&mut state)?;`
The change gets a loan of the threads that it may change; `update` owns them again afterwards and saves them.

## Reading a hand-off file
`src/state/store.rs::get` reads a small JSON file that the UI and the AI pass to each other, such as what the user is looking at.
route: Same file: how the AI reads what the user has open.

### `pub fn get<T: DeserializeOwned>(repo_root: &Path, h: HandOff) -> Result<Option<T>> {`
The caller says what type it wants, and serde reads the JSON into it, checking its shape. `DeserializeOwned` means "a type serde can read into". A missing file isn't an error: it gives `Ok(None)`.

### `Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),`
A guard on an error arm: "file not found" becomes "nothing", and every other error goes on to the next arm.

## The AI's side
`src/cli/threads.rs::wait` is how the AI hears your comments: it runs in the background, and returns once a thread is waiting for an answer. The AI's session then wakes and replies with `visvet reply`.
route: Back to src/cli: the commands the AI runs to answer comments.

### `loop {`
A loop with no condition, left only by `return` or `break`.

### `std::thread::sleep(Duration::from_secs(2));`
Checks every two seconds. `Duration` is a type, not a number of milliseconds, so a unit mix-up can't happen.

## The UI's package.json
`ui/package.json` is the UI's own package. It is built with Vite, as many Vue apps are, and uses React instead of Vue.
route: Over to ui, the browser half: what the map is built with.

### `"build": "tsc && vite build"`
`tsc` checks the TypeScript types; Vite then bundles the code into `ui/dist`, which the Rust program serves and embeds.

### `"react": "^19.3.1",`
React draws the UI from components, which are plain functions, with no templates and no single-file components.

### `"@xyflow/react": "^12.12.0",`
React Flow: the pan-and-zoom canvas that boxes and arrows sit on.

### `"elkjs": "^0.12.0",`
ELK works out where each box and arrow goes. React Flow only draws them.

## The contract, in TypeScript
`ui/src/contract.ts::BoxContent` is ts-rs's TypeScript copy of the Rust enum you saw in `src/types/boxes.rs`. Nobody edits this file: `cargo test` writes it.
route: Into ui/src: the generated copy of the Rust types.

### `export type BoxContent = { "type": "code", kind: BoxKind, members: Array<Member>, implements: Array<TraitRef>,`
The `code` variant as a TypeScript object type. The `|` that follows it joins the other variants into a union. TypeScript types exist only while compiling: at runtime this is plain JSON.

## Fetching the review
`ui/src/model.ts::getReview` asks the server for the review: the GET `/api/review` the server's `review` handler answers.
route: Over to model.ts: the UI's end of the request.

### `export const getReview = (): Promise<Review> => req('/api/review').then(r => r.json())`
`(): Promise<Review>` is the return type. `r.json()` is untyped at runtime: TypeScript trusts the annotation, and the generated contract is what makes it true.

## The tree the UI draws
`ui/src/model.ts::Item` is one folder, file, box or member, in a tree the UI builds from the review.
route: Same file: the UI's own shape for each box.

### `depth: number; kids: Item[]; parent?: Item; o?: MapBox; m?: Member`
`?` marks a field that may be missing, which TypeScript makes you check before use, as Rust's `Option` does. TypeScript types are structural: any object with these fields is an `Item`, whatever made it.

## Building the tree
`ui/src/model.ts::index` turns the review's flat list of boxes into the tree of folders, files, boxes and members.
route: Same file: from the server's flat list to a tree.

### `const add = (it: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>, parent?: Item) => {`
Utility types: `Partial<Item>` is `Item` with every field optional, `Pick` takes some fields, and `&` joins them. So: "any fields of an item, but `id`, `kind` and `name` are a must".

### `;(parent?.kids ?? roots).push(item)`
Adds the item to its parent's children, or to the roots when it has none.

### `return { items, roots, all, order: all.filter(it => !it.ctx) }`
No return type is written: TypeScript infers it, and `type Index = ReturnType<typeof index>` names it for the rest of the UI.

## Context: React's provide and inject
`ui/src/context.ts` declares what every component can read: the review, the selection, and the actions that change them.
view: zoomed
route: Over to context.ts: what every component can reach.

### `export const X = createContext<Ctx>(null!)`
React's context is Vue's `provide`/`inject`. The app provides a value with `<X.Provider value={...}>`, and any component inside reads it with `useContext(X)`. `null!` tells TypeScript "trust me, never null": the provider always sets it.

### `select: (id: string, replace?: boolean) => void`
A function type in an object type: the context passes actions down, as well as data.

## A custom hook
`ui/src/main.tsx::useModel` loads the review and reloads it on each server event. A function named `use...` that calls React's hooks is a custom hook: Vue's composables.
route: Over to main.tsx, the app's shell, where the review is loaded.

### `const [model, setModel] = useState<Review>()`
`useState` is Vue's `ref`, with one big difference. React has no proxies watching your objects: you call `setModel` with a new value, and React runs the component function again to draw it. Changing an object in place draws nothing.

### `useEffect(() => {`
`useEffect` runs its function after the component draws. With `[]` as its last argument, as here, it runs once, like `onMounted`. The function it returns is the clean-up, like `onUnmounted`: `return () => events.close()`.

### `events = new EventSource('/api/events')`
The browser's end of the server's `events` stream: each `change` event loads the review again.

### `getReview().then(m => { if (n > shown) { shown = n; setModel(m); setError(undefined) } }, e => n > shown && setError(e.message))`
Each load gets a number, and a slow answer that comes after a newer one is dropped.

## The app component
`ui/src/main.tsx::App` is the root component: a function that returns what to draw. React calls it again whenever its state changes.
route: Same file: the root component that holds it all.

### `const ix = useMemo(() => model && index(model), [model])`
`useMemo` is Vue's `computed`, but you list what it depends on yourself: the tree is built again only when `model` changes.

### `if (wide.view !== view) setWide({ view, ids: new Set() })`
Setting state while drawing: when the view changes, the boxes opened in the old view are forgotten. React runs the function again at once with the new state.

### `if (!model || !ix) return error ? <p className="fatal">{error}</p> : null`
JSX: HTML-like tags in TypeScript, compiled into function calls. `{...}` holds any expression, like `{{ }}` in a Vue template. The early return comes after every hook call, which is a rule: React tells hooks apart by the order they run in, so they must run the same way on every call.

### `<X.Provider value={x}>`
Provides the context to everything inside it.

## JSX in place of a template
`ui/src/main.tsx::Header` is the top bar. Here are Vue's template tools in JSX.
route: Same file: the top bar, and how JSX does what Vue templates do.

### `const x = useContext(X)`
Vue's `inject`.

### `{path.map(it => <Fragment key={it.id}><span>›</span><a className={it.id === x.scope ? 'here' : ''} onClick={() => to(it.id)}>{it.name}</a></Fragment>)}`
`map` is `v-for`, and `key` is `:key`. `className` is `class`, since `class` is a JavaScript word, and `onClick={...}` is `@click`. `Fragment` groups tags without adding an element, like Vue's `<template>`.

### `{error && <span className="err">Refresh failed: {error}</span>}`
`&&` is `v-if`: when `error` is empty, nothing is drawn.

## What one view shows
`ui/src/view.ts::mapView` works out what one map view shows: its boxes, the arrows between them, and the outside boxes they reach. It is plain TypeScript, with no React, so it is easy to test and read.
route: Over to view.ts: the logic behind each view of the map.

### `const { exact, ext } = linkEnds(ix, links.filter(e => shows(e.kind)), top, ids, sel)`
Each arrow ends at the box this view draws: an arrow to a box inside a closed one ends at the closed box.

### `return { boxes: [...inner, ...ext.values()], ext, edges, detail, owner, rowsOf, expands, openable, up }`
Data and the functions to read it, in one object. `View = ReturnType<typeof mapView>` names its type.

## The map component
`ui/src/Graph.tsx::Graph` draws one view: it gets the view, has ELK lay it out, places the camera, and gives the boxes and arrows to React Flow.
route: Over to Graph.tsx: the map itself.

### `const box = useRef<HTMLDivElement>(null)`
`useRef` is Vue's template ref: `ref={box}` on an element puts that element in `box.current`. A ref also holds any value that should last between calls without causing a redraw.

### `const [kinds, setKinds] = useState<Record<string, boolean>>({})`
Which arrow kinds the user switched on or off. `Record<string, boolean>` is an object used as a map from text to true or false.

### `const { layout: graph, current } = useLayout(view, v, it => height(it, x, rowsOf(it)), it => width(it, rowsOf(it), x), stepBubbleBox(x))`
Custom hooks keep this function short: layout, camera and selection each have their own hook. `{ layout: graph, current }` takes two fields out of the object the hook returns, renaming `layout` to `graph`.

## Async work in an effect
`ui/src/Graph.tsx::useLayout` lays a view out with ELK, which works asynchronously, and keeps the result in state.
route: Same file: laying a view out, which takes a moment.

### `let live = true`
ELK may finish after the view has changed. The clean-up sets `live` to false, so an old answer is never shown: `return () => { live = false }`.

### `}, [key])`
The dependency list: the effect runs again only when `key` changes, like Vue's `watch(key, ...)`. The key holds everything that shapes the layout, so the same view is never laid out twice.

## ELK's input
`ui/src/Graph.tsx::elkGraph` builds what ELK lays out: a node per box, nested in its parent's node, and an edge per arrow.
route: Same file: what the layout engine is given.

### `for (const it of v.boxes) (nodes.get(v.up(it)?.id ?? '') || root).children!.push(nodes.get(it.id)!)`
Each box goes inside its parent box's node, or at the top. `!` after a value tells TypeScript it can't be null or undefined here: use it only when you know.

## One box
`ui/src/Card.tsx::Card` draws one box on the map: its header, doc, members and code. React Flow calls it for each node.
route: Over to Card.tsx: one box on the map.

### `export function Card({ data }: NodeProps<Node<CardData>>) {`
A component's props are its function's argument, taken apart in the parameter list. There is no `defineProps`: the type is the declaration.

### `const code = useMemo(() => allLines(it), [it])`
Worked out once per box, so its syntax colours aren't worked out on every draw.

### `{showsCode(it, x) &&`
Only a box opened with More shows its code.

## Code in a box
`ui/src/Views.tsx::DiffView` draws a box's code and diff, folding long unchanged runs.
route: Over to Views.tsx: the code inside a box.

### `const [unfolded, setUnfolded] = useState(new Set<number>())`
The folds the user has opened.

### `setUnfolded(new Set(unfolded).add(start))`
A new `Set`, never the old one changed: React sees a change only when it gets a new object. In Vue you would write `unfolded.add(start)`.

### `const coloured = useMemo(() => highlighter && colourLines(highlighter, diff, language), [highlighter, diff, language])`
`computed` again, depending on three values.

## Loading in the background
`ui/src/highlight.ts::useHighlighter` gives the syntax highlighter once Shiki, the colourer VS Code's themes come from, has loaded. Until then, code shows plain.
route: Over to highlight.ts: syntax colours.

### `useEffect(() => void loading.then(setHighlighter), [])`
An effect may return only a clean-up function, so `void` throws away the promise that `then` returns. `setHighlighter` is passed as the callback itself.

## A comment box
`ui/src/Threads.tsx::Say` is the field you type a comment in.
route: Over to Threads.tsx: where you write to the AI.

### `value={text} onChange={e => setText(e.target.value)}`
A "controlled" field: Vue's `v-model`, written out. The field shows the state, and each key press sets the state.

### `const submit = () => text.trim() && send(text.trim()).then(() => { setText(''); done() }, alert)`
Sending posts to `/api/threads`, which `store::new_thread` saves as a file, and the AI's `visvet wait` wakes up.

## An effect on every draw
`ui/src/Tours.tsx::useArrowKeys` steps through a tour with the arrow keys.
route: Over to Tours.tsx: the tour you are taking now.

### `return () => removeEventListener('keydown', press)`
This effect has no dependency list, so it runs after every draw: the old listener is removed and a new one, which sees the current step, is added. A listener added once would keep the step from when it was made.

## Moving the camera
`ui/src/nestedZoom.tsx::glideCamera` moves the map's camera smoothly from one place to another, one animation frame at a time. Every move on this tour went through it.
route: Over to nestedZoom.tsx: the code that moved you around the map.

### `return new Promise<boolean>(done => {`
The glide is a promise, so callers can `await` it: true if it finished, false if a newer glide took over.

### `const zoom = from.zoom * (to.zoom / from.zoom) ** eased`
The zoom changes by the same ratio each frame, not the same amount, so zooming in from 50% to 100% feels as even as from 100% to 200%.

### `if (progress < 1) return void requestAnimationFrame(frame)`
`requestAnimationFrame` calls `frame` before the browser's next draw, so the camera moves once per screen refresh.

## Where to go next
`tours/README.md` explains how to write a tour like this one. Try "The tour feature" tour next: it reviews how tours work.
route: Out to the tours folder, to finish where tours are written.

Then try the review loop: select a box, type a comment, and the AI answers in its thread.
