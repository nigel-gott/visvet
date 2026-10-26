---
kind: tour
description: A review of the tours work by touring it: syntax colours, tour files, and how a tour is read and checked.
---
# The tour feature

## Tour files
A tour is a Markdown file in `tours/README.md`'s folder. This very file is one: each `##` heading is a step, the first name in backticks is the box it shows, and `###` headings with code in backticks are notes on pieces of that code.

Plain Markdown means a tour is reviewed like any other file, and each box it names gets a "links" arrow on the map.

## What a tour is, as data
`src/types/tours.rs::Tour` is the shape the server sends the UI. Every type in `src/types/` is part of the "contract": ts-rs writes a TypeScript copy of each into `ui/src/contract.ts`, so both sides agree.

### `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]`
`derive` asks the compiler to write standard code for the type. Here: `Serialize`/`Deserialize` turn it to and from JSON (serde), `Clone` lets you copy it, `Debug` prints it, `PartialEq` lets tests compare with `==`, and `TS` writes its TypeScript copy.

In Vue terms: it's like getting `JSON.stringify` support and a `.d.ts` file for free, per type.

### `pub steps: Vec<TourStep>,`
`Vec<T>` is Rust's growable array, like a JS array that only holds one type. `pub` makes the field visible outside this file; Rust fields are private by default.

## A step and its notes
`src/types/tours.rs::CodeNote` is one note on a piece of code.

### `pub span: Option<CodeSpan>,`
Rust has no `null`. A value that may be missing is an `Option`: either `Some(span)` or `None`. The compiler makes you handle both, so "forgot to check for null" can't happen. Here `None` means the code isn't there any more: the note is stale.

## Reading a tour file
`src/review/tours.rs::parse_tour` walks the file line by line and sorts each line into the title, a step, a note, or text.

### `in_fence ^= line.trim_start().starts_with("```");`
`^=` flips a true/false each time a code fence starts or ends, so a `# comment` inside a code block isn't taken for a heading.

### `} else if let Some(step) = steps.last_mut() {`
`if let` is a `match` with one arm: "if there is a last step, call it `step` and run this". `last_mut()` returns an `Option`, since the list may be empty, and gives a reference you can change ("mut" for mutable).

## Checking a step against the code
`src/review/tours.rs::check_step` finds the step's box and where each note's code sits in it.

### `let target = MapId(text.split('`').nth(1).unwrap_or("").into());`
Splitting on backticks puts the first name in backticks at position 1. `MapId(...)` wraps the text in a "micro type", a string that the compiler won't mix up with other strings.

### `span: lines.and_then(|lines| find_code(lines, note_code))`
`|lines| ...` is a closure, Rust's arrow function. `and_then` runs it only when there are lines, so a missing box gives `None` without an `if`.

## Finding a piece of code
`src/review/tours.rs::find_code` searches the box's current lines for the note's code.

### `let start = joined.find(code).filter(|_| !code.is_empty())?;`
The `?` at the end means "if this is `None`, return `None` from the whole function right now". It replaces a lot of `if (!x) return null` lines.

## Columns that JavaScript agrees with
`src/review/tours.rs::position` turns a byte offset into a line and column.

### `encode_utf16().count()`
Rust strings are UTF-8 bytes; JavaScript strings count UTF-16 units. Counting the column the JavaScript way means the UI can cut a line at exactly this column, even after an emoji.

## Tours join the review
`src/review.rs::build_review` builds everything the UI gets. Tours are read last, because checking them needs every box.

### `let tours = tours::read_tours(repo_root, &boxes);`
`&boxes` lends the boxes to `read_tours` without giving them away. That's borrowing: Rust tracks who owns each value, and a borrow lets a function read it while the caller keeps it.

## Checking tours from the command line
`src/cli/tours.rs::print` is `visvet tours`: it prints each tour's steps and marks stale ones, so whoever writes a tour can check it after the code changes.

## Each box knows its language
`src/types/language.rs::Language` is worked out from a file's extension on the server and sent with every box, so the UI never reads file names itself.

### `#[serde(rename_all = "lowercase")]`
In JSON each variant becomes a lowercase string, e.g. `TypeScript` becomes `"typescript"`, which is what the TypeScript copy says too.

## Colouring code
`ui/src/highlight.ts::colourLines` colours a box's code with Shiki, the highlighter VS Code's grammars run in.

### `for (const leftOut of ['del', 'add'])`
A diff mixes two versions of the code. The loop colours each version whole: first without removed lines (the new code), then without added lines (the old code), so a line inside a multi-line comment still colours right.

## A React hook
`ui/src/highlight.ts::useHighlighter` is a React hook: a function whose name starts with `use` and which keeps state between renders.

### `useEffect(() => void loading.then(setHighlighter), [])`
`useState` is React's `ref()`, and `useEffect` with an empty list `[]` runs once after the component first shows, like Vue's `onMounted`. When Shiki has loaded, `setHighlighter` stores it and React re-renders every box with colours.
