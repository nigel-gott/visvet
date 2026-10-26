---
kind: tour
description: A review of the tours work by touring it: syntax colours, tour files, and how a tour is read and checked.
---
# The tour feature

## Tour files
This step shows the tour you're taking, `tours/tour-feature.md`: a tour is a Markdown file in the `tours` folder. Plain Markdown means a tour is reviewed like any other file, and each box it names gets a "links" arrow on the map.

Each step shows its box among its neighbours, every box around it open, unless the step says `view: zoomed` on a line of its own.

### `kind: tour`
The front matter says this file is a tour. `description:` says what it is for.

### `## Tour files`
Each `##` heading is a step: this one. The first name in backticks in its text is the box the step shows, and `###` headings like the one above this note are notes on pieces of that box's code. `tours/README.md` explains the format in full.

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

### `let span = lines.filter(|_| on_box.is_none()).and_then(|lines| find_code(lines, note_code));`
`|lines| ...` is a closure, Rust's arrow function. `filter` drops the lines when the note is about a whole box, and `and_then` runs `find_code` only when lines are left, so either case gives `None` without an `if`.

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

## Picking a tour
`ui/src/Tours.tsx::TourBar` sits in the top bar: a list of tours, then while one plays, its name, a progress bar and ✕ to leave.

### `if (!x.model.tours.length) return null`
A React component is a function that returns what to show. Returning `null` shows nothing, like `v-if="false"` on the whole template.

### `{x.model.tours.map(tour => <option key={tour.file} value={tour.file}>{tour.title}</option>)}`
JSX is HTML written inside JavaScript: `{…}` holds a JavaScript expression, like Vue's `:value`. A list is a plain `.map`, where Vue uses `v-for`, and `key` is Vue's `:key`.

### `<progress max={tour.steps.length} value={number + 1} />`
How far through the tour you are, as a plain HTML progress bar.

## The step's bubble
`ui/src/Tours.tsx::StepBubble` is the speech bubble above the step's box: its title, text, and Back, a dot per step, and Next.

### `const lost = step.code_notes.filter(note => !note.span && !note.on_box)`
A note whose code can't be found any more has nowhere to sit, so the bubble lists it in red: the tour needs updating.

### `<button className="primary" onClick={() => go(number + 1)}>{last ? 'Finish ✓' : 'Next ›'}</button>`
`onClick` is Vue's `@click`. On the last step, Next becomes Finish and leaves the tour.

## Arrow keys
`ui/src/Tours.tsx::useArrowKeys` lets ← and → step through the tour, except while you type in a field.

### `const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key]`
A lookup table instead of an `if`: the key's step, or `undefined` for any other key.

## Bubbles go on the boxes
`ui/src/Card.tsx::Card` draws every box. While a tour plays, the step's box gets the step bubble and its notes on code, and a box a note names gets that note in a bubble of its own.

### `const stepHere = playing?.step.target === it.id`
`?.` stops at a missing value instead of throwing: with no tour playing, `stepHere` is simply false.

### `ui/src/Tours.tsx::BoxBubble`
This bubble is itself a note on a whole box: its `###` heading in the tour file names a box instead of code, so the server sets `on_box`, and `BoxBubble` draws the note above that box.

## Notes under the code they explain
`ui/src/Views.tsx::DiffView` draws a box's code. The lines a note is about get an amber band, and the note sits in a bubble right under them.

### `<div className={`ln ${l.kind} ${isNoted(l, notes) ? 'noted' : ''}`}>`
A template string builds the class list, like Vue's `:class` with an object.

### `{l.kind !== 'del' && notes.filter(note => note.span!.end.line === l.line).map((note, index) => <CodeBubble key={index} note={note} />)}`
After each line, the notes whose code ends on it. `!` tells TypeScript "this can't be missing here": only notes with a place in the code reach `DiffView`.

## Room for the bubble
`ui/src/Graph.tsx::useFit` moves the camera to each step's box, keeping a fixed room above it for the bubble.
view: zoomed

### `const top = 48 + (bubbleAbove ? STEP_BUBBLE_ROOM : 0)`
The bubble isn't drawn yet when the camera moves, so its height can't be measured. Instead it has a fixed most height (longer text scrolls inside it), and the camera always leaves that much room.

## Where the tour's state lives
`ui/src/main.tsx::App` holds which tour plays and its step, and passes them down in the context `x`, React's `provide`/`inject`.
view: zoomed

### `const [tour, setTour] = useState<TourPlace | null>(null)`
`useState` returns the value and a function to change it; calling `setTour` re-renders. `<TourPlace | null>` is TypeScript: it holds a place in a tour, or nothing.

### `if (!elsewhere) return showBox(step.target, step.view)`
Each step shows its box the way the step chose: among its neighbours, or zoomed in. When the next step is in another part of the map, the camera first zooms out to the box holding both places, rests there for a moment, then zooms into the new step, so you see where it is compared to the last one.

### `travel.current = setTimeout(() => showBox(step.target, step.view), TRAVEL_PAUSE)`
`useRef` keeps a value between renders without re-rendering, like a plain variable in Vue's `setup()`. It holds the pending second half of the move, so pressing Next again quickly cancels it.
