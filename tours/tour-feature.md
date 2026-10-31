---
kind: tour
description: A review of the tours work by touring it: syntax colours, tour files, and how a tour is read and checked.
---
# The tour feature

## Tour files
This step shows the tour you're taking, `tours/tour-feature.md`: a tour is a Markdown file in the `tours` folder. Plain Markdown means a tour is reviewed like any other file, and each box it names gets a "links" arrow on the map.
route: Starting at the tour file itself: everything else is read from it.

Each step shows its box among its neighbours, closed around it, unless the step says `view: zoomed` on a line of its own. A `route:` line is the purple note shown while the map moves to the step.

### `kind: tour`
The front matter says this file is a tour. `description:` says what it is for.

### `## Tour files`
Each `##` heading is a step: this one. The first name in backticks in its text is the box the step shows, and `###` headings like the one above this note are notes on pieces of that box's code. `tours/README.md` explains the format in full.

## What a tour is, as data
`src/types/tours.rs::Tour` is the shape the server sends the UI. Every type in `src/types/` is part of the "contract": ts-rs writes a TypeScript copy of each into `ui/src/contract.ts`, so both sides agree.
route: Down into src/types: first, the shape a tour takes as data.

### `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]`
`derive` asks the compiler to write standard code for the type. Here: `Serialize`/`Deserialize` turn it to and from JSON (serde), `Clone` lets you copy it, `Debug` prints it, `PartialEq` lets tests compare with `==`, and `TS` writes its TypeScript copy.

In Vue terms: it's like getting `JSON.stringify` support and a `.d.ts` file for free, per type.

### `pub steps: Vec<TourStep>,`
`Vec<T>` is Rust's growable array, like a JS array that only holds one type. `pub` makes the field visible outside this file; Rust fields are private by default.

## A step and its notes
`src/types/tours.rs::CodeNote` is one note on a piece of code.
route: Next door, same file: the notes a step makes on pieces of code.

### `pub span: Option<CodeSpan>,`
Rust has no `null`. A value that may be missing is an `Option`: either `Some(span)` or `None`. The compiler makes you handle both, so "forgot to check for null" can't happen. Here `None` means the code isn't there any more: the note is stale.

## Each box knows its language
`src/types/language.rs::Language` is worked out from a file's extension on the server and sent with every box, so the UI never reads file names itself.
route: Still in src/types: the other new type, a file's language.

### `#[serde(rename_all = "lowercase")]`
In JSON each variant becomes a lowercase string, e.g. `TypeScript` becomes `"typescript"`, which is what the TypeScript copy says too.

## Reading a tour file
`src/review/tours.rs::parse_tour` walks the file line by line and sorts each line into the title, a step, a note, or text.
route: Over to src/review, where the server reads tour files.

### `in_fence ^= line.trim_start().starts_with("```");`
`^=` flips a true/false each time a code fence starts or ends, so a `# comment` inside a code block isn't taken for a heading.

### `} else if let Some(step) = steps.last_mut() {`
`if let` is a `match` with one arm: "if there is a last step, call it `step` and run this". `last_mut()` returns an `Option`, since the list may be empty, and gives a reference you can change ("mut" for mutable).

## Checking a step against the code
`src/review/tours.rs::check_step` finds the step's box and where each note's code sits in it.
route: Same file: once read, each step is checked against the code.

### `let first_named = text.split('`').nth(1).unwrap_or("");`
Splitting on backticks puts the first name in backticks at position 1.

### `let target = MapId(setting("box").map_or(first_named, |named| named.trim_matches('`')).into());`
A `box:` line names the step's box, so a step can be told only in its notes; without one, it is the first name in backticks. `MapId(...)` wraps the text in a "micro type", a string that the compiler won't mix up with other strings.

### `let span = lines.filter(|_| on_box.is_none()).and_then(|lines| find_code(lines, note_code));`
`|lines| ...` is a closure, Rust's arrow function. `filter` drops the lines when the note is about a whole box, and `and_then` runs `find_code` only when lines are left, so either case gives `None` without an `if`.

## Finding a piece of code
`src/review/tours.rs::find_code` searches the box's current lines for the note's code.
route: Same file: how a note finds its piece of code.

### `let start = joined.find(code).filter(|_| !code.is_empty())?;`
The `?` at the end means "if this is `None`, return `None` from the whole function right now". It replaces a lot of `if (!x) return null` lines.

## Columns that JavaScript agrees with
`src/review/tours.rs::position` turns a byte offset into a line and column.
route: Same file: turning a match into a line and a column.

### `encode_utf16().count()`
Rust strings are UTF-8 bytes; JavaScript strings count UTF-16 units. Counting the column the JavaScript way means the UI can cut a line at exactly this column, even after an emoji.

## Tours join the review
`src/review.rs::build_review` builds everything the UI gets. Tours are read last, because checking them needs every box.
route: Up to review.rs, where tours join everything the UI gets.

### `let tours = tours::read_tours(repo_root, &boxes);`
`&boxes` lends the boxes to `read_tours` without giving them away. That's borrowing: Rust tracks who owns each value, and a borrow lets a function read it while the caller keeps it.

## Checking tours from the command line
`src/cli/tours.rs::print` is `visvet tours`: it prints each tour's steps and marks stale ones, so whoever writes a tour can check it after the code changes.
route: Across to the command line: checking tours by hand.

## Colouring code
`ui/src/highlight.ts::colourLines` colours a box's code with Shiki, the highlighter VS Code's grammars run in.
route: Over to the UI in ui/src: how code gets its colours.

### `for (const leftOut of ['del', 'add'])`
A diff mixes two versions of the code. The loop colours each version whole: first without removed lines (the new code), then without added lines (the old code), so a line inside a multi-line comment still colours right.

## A React hook
`ui/src/highlight.ts::useHighlighter` is a React hook: a function whose name starts with `use` and which keeps state between renders.
route: Same file: the React hook that loads those colours.

### `useEffect(() => void loading.then(setHighlighter), [])`
`useState` is React's `ref()`, and `useEffect` with an empty list `[]` runs once after the component first shows, like Vue's `onMounted`. When Shiki has loaded, `setHighlighter` stores it and React re-renders every box with colours.

## Picking a tour
`ui/src/Tours.tsx::TourBar` sits in the top bar: a Tours button opening the list of tours, each to resume or start over; while one plays, its name (opening a list of its steps), Back and Next, the step number and ✕ to leave.
route: To Tours.tsx, where you picked this tour.

### `if (!x.model.tours.length) return null`
A React component is a function that returns what to show. Returning `null` shows nothing, like `v-if="false"` on the whole template.

### `useEffect(() => { if (playing) rememberStep(playing.tour.file, playing.number) }, [playing?.tour.file, playing?.number])`
Each time the step changes, this browser remembers it, so the Tours list can offer to resume there.

### `{menu && <StepList tour={tour} number={number} go={go} />}`
`&&` is `v-if`: the list of steps shows only while `menu` is true. A click outside closes it (`useClosesOnClickOutside`).

## The step's bubble
`ui/src/Tours.tsx::StepBubble` is the speech bubble above the step's box: its title, text, and Back and Next. The step number at its top says how far through the tour you are.
route: Same file: the bubble you're reading now.

### `const lost = step.code_notes.filter(isLost)`
A note whose code can't be found any more has nowhere to sit, so the bubble lists it in red: the tour needs updating. A step with no text still gets a bubble then, to say so.

### `<button className="primary" onClick={() => go(number + 1)}>{last ? 'Finish ✓' : 'Next ›'}</button>`
`onClick` is Vue's `@click`. On the last step, Next becomes Finish and leaves the tour.

## Arrow keys
`ui/src/Tours.tsx::useArrowKeys` lets ← and → step through the tour, except while you type in a field.
route: Same file: stepping with the keyboard.

### `const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key]`
A lookup table instead of an `if`: the key's step, or `undefined` for any other key.

## The route you travel
`ui/src/Tours.tsx::RouteOverlay` draws the line of stops at the top of the map while you move between steps, filled in up to where the camera is, with the step's note on why in purple under it.
route: Same file: the line of stops you just watched fill in.

### `{x.route.note && <p className="route-note">{x.route.note}</p>}`
The note comes from a `route:` line in the tour file, like the one in this step. It's taken out of the step's text, so it only shows while you travel.

## Bubbles go on the boxes
`ui/src/Card.tsx::Card` draws every box. While a tour plays, the step's box gets the step bubble and its notes on code, and a box a note names gets that note in a bubble of its own.
route: To Card.tsx: how bubbles and notes get onto boxes.

### `const stepHere = x.stepBox === it.id`
Whether this box is the one the tour's step shows. `stepBox` is empty with no tour playing, and while you drive to the next step, so the step you left hides its notes.

### `ui/src/Tours.tsx::BoxBubble`
This bubble is itself a note on a whole box: its `###` heading in the tour file names a box instead of code, so the server sets `on_box`, and `BoxBubble` draws the note above that box.

## Notes under the code they explain
`ui/src/Views.tsx::DiffView` draws a box's code. The lines a note is about get a purple band, and the note sits in a bubble right under them.
route: To Views.tsx: notes sit under the lines they explain.

### `<div className={`ln ${l.kind} ${isNoted(l, notes) ? 'noted' : ''}`} style={{ marginTop: beside && l.kind !== 'del' ? room.above.get(l.line) : undefined }}>`
A template string builds the class list, like Vue's `:class` with an object. With notes beside the code, some lines get extra space above them, so no note covers code or another note.

### `{!beside && l.kind !== 'del' && notes.filter(note => note.span!.end.line === l.line).map(note => <CodeBubble key={note.code} note={note} />)}`
After each line, the notes whose code ends on it, unless they sit in the margin beside the code. `!` tells TypeScript "this can't be missing here": only notes with a place in the code reach `DiffView`.

## The bubble is a box of its own
`ui/src/Graph.tsx::elkGraph` builds what ELK lays out. While a tour step shows a box, its bubble is part of the layout, so the layout makes room for it and it never covers anything.
route: To Graph.tsx: how the layout makes room for this bubble.
view: zoomed

### `targetNode.width = bubble.width + BUBBLE_GAP + cardWidth`
The bubble is folded into its box's own node: the node grows by the bubble's width, and once ELK has placed it, `unfold` splits it back into the bubble on the left and the box on the right. ELK can't separate what it sees as one box, so the bubble always sits right beside its box, level with its top. Its height is worked out from its text before it is drawn (`stepBubbleBox`), since the layout needs every size up front.

### `{ id: arrowsIn, x: bubble.width + BUBBLE_GAP + PORT_INSET, y: 0, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'NORTH' } },`
Ports: fixed points where arrows attach. Arrows into the box come in at its own top edge, and arrows out leave its right edge, so none ends at the bubble.

### `sources: [STEP_BUBBLE], targets: [target.id]`
A box that draws boxes inside it (a zoomed step) can't grow sideways without moving them, so its bubble is a node of its own, with an edge to the box. ELK puts an edge's start to the left, so the bubble lands just left of the box; after layout, `levelWithBox` lines it up with the box's top.

## Boxes slide into place
`ui/src/Graph.tsx::useRelayoutMotion` makes a new layout of the same view slide in: when a box opens or a step's bubble arrives, every box moves and grows to its new place instead of jumping, and arrows wait out of sight.
route: Up to Graph.tsx: how a layout change animates.

### `motion.current = { graph, until: sameView ? Date.now() + RELAYOUT_TIME : 0 }`
Worked out while drawing, not in an effect: the boxes' new positions must already have the motion on, or they would jump before it starts. A new view's layout appears as it is.

### `const sliding = Date.now() < motion.current.until`
While this is true, the map has the `relayout` class, whose CSS transitions the boxes' place and size with the camera's easing.

## Framing the step
`ui/src/Graph.tsx::useFit` places the camera for each view. For a tour step it frames the step's box and bubble, as close as shows them whole.
route: Same file: where the camera goes for a step.

### `const closest = absolute(graph.laid, STEP_BUBBLE) ? CLOSEST_FRAMING : 1`
A step's box with its bubble may be framed past full size, up to 1.6×, so a small box fills the screen; a box on its own (after Next closes it) at full size at most.

### `const hit = c && graph.view === view ? around(withBubble(graph.laid, absolute(graph.laid, c)), alsoShow ? absolute(graph.laid, alsoShow) : undefined) : undefined`
What to frame: the highlighted box, its bubble if laid out, and with "you drive" after Next, also the box to click next, so the box you left and the way on are both in view.

## Where the tour's state lives
`ui/src/main.tsx::App` holds which tour plays and its step, and passes them down in the context `x`, React's `provide`/`inject`.
route: To main.tsx, where the tour's state lives and journeys are planned.
view: zoomed

### `const [tour, setTour] = useState<TourPlace | null>(null)`
`useState` returns the value and a function to change it; calling `setTour` re-renders. `<TourPlace | null>` is TypeScript: it holds a place in a tour, or nothing.

### `await zoomer.prepare?.(hops.map(hop => ({ to: hop, ...setupOf(hop) })))`
Moving to the next step passes through each zoom level between the two places: out to the box holding both, then in. Every view on that route is laid out before the camera sets off, so it never waits for one: the views on the way as they look with the step playing now, the last one with the step it's heading to. `{ to: hop, ...setupOf(hop) }` spreads one object's fields into another, as in JavaScript; `?.` skips the call when there's nothing to call.

### `await (zoomer.run ? zoomer.run(hop, enter, setupOf(hop), journeyMotion(level, hops.length)) : enter())`
Each level is one zoom, the same as double-clicking or pressing Up, but `journeyMotion` gives it a slice of one long ease, so the camera only slows at the start and the end, never between levels. `await` waits for each level before the next, as in JavaScript. The step itself only changes as its view takes over (`arriving`), so the view you leave stays as it was.

### `if (moves.byHand && jump) {`
With "you drive", the top bar's Back and Next, the step list, Resume and the arrow keys jump: the step's view opens at once, framed, with no journey.

### `if (moves.byHand) {`
Otherwise, with "you drive", the move is left to you: the step to reach is kept as `heading`, and the cues (`guide`) say what to do next.

### `const stayOpenFor = (id: string) => [...expanded].filter(open => within(ix.items.get(id), open) || within(ix.items.get(open), id))`
Boxes that hold the next step's box, or sit inside it, stay open, so moving between steps in one file only moves the bubble.

### `const reached = !!headingStep && !way.length && (headingStep.view === 'zoomed' || sel === headingStep.target)`
You've reached a step when you are in its view and, unless it is zoomed, have clicked its box. Then it opens, bubble and all.

### `const journey = useRef(0)`
`useRef` keeps a value between renders without re-rendering, like a plain variable in Vue's `setup()`. Each move gets a number; pressing Next again starts a newer one, and the older move stops at its next level.

## The way on, in the breadcrumbs
`ui/src/main.tsx::WayAhead` continues the breadcrumbs with the way to the next step when you drive: the stops ahead in purple, the next move pulsing, then the step's title and note.
route: Up to main.tsx's breadcrumbs: the way on, when you drive.

### `const ahead = guide.stops.slice(1).filter((stop): stop is string => stop !== null && !here.has(stop))`
The stops still to come: those not already in the breadcrumbs. `stop is string` tells TypeScript that the filter leaves only strings, no `null`.

### `onClick={() => x.zoom(stop)}>{name(stop)}</a>)}`
Each stop goes there when clicked; the next one to double-click into pulses.

## How the camera moves
`ui/src/nestedZoom.tsx::glideCamera` moves the camera frame by frame, so nothing can cut a move short, and a newer move always takes over from an older one.
view: zoomed
route: To nestedZoom.tsx: the camera moves you've been riding.

### `const glide = ++latestGlide, duration = paced(motion.duration)`
`paced` applies the speed picked in the top bar: instant, 1×, 2×, 4× or 6×. The menu's last choice, "you drive", leaves the moves between steps to you (see `App` and `WayAhead`), and your own zooms run at 1×.

### `const zoom = from.zoom * (to.zoom / from.zoom) ** eased`
The zoom changes by the same factor each frame, not the same amount, so zooming in and out reads at an even pace.
