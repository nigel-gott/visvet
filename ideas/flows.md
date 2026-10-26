# Flows

A set of highlighted arrows and boxes that happen together: a request, a data flow, a user action going through the code. Today the map focuses on one box and its neighbours. A flow lights up many connected boxes at different levels, and you pan along it.

Not the same as a [tour](tours.md): a tour is ordered steps chosen for a reader; a flow is what really runs. A tour can follow a flow.

## A test is a flow

A test runs one path through the code. That makes flows derivable, not hand-written:

- **Per-test coverage:** `cargo llvm-cov` (and V8 coverage for TypeScript) can report which functions each test ran. Joined with the map's call arrows, that's the flow's boxes and its order.
- **Tracing:** a span tracer (Rust `tracing`, OpenTelemetry) gives the exact call order, also for a real run of the app, not only tests.

So the behaviour-style [tests](tests.md) are both the checks and the flow definitions. No upkeep: when the code changes, the flow is re-derived.

## Persisted and committed

Running the tests with tracing on produces the flows; visvet saves them in the repo and they're committed.

- A flow that changes shows up as a diff in review: "this request now also goes through X". Often that's the most useful thing to review.
- A flow that breaks or vanishes unexpectedly is a bug, like a failing test.
- Saved, not re-run on every view, so the map stays fast and works without running anything.
- The [methodology](methodology.md) makes OpenTelemetry tracing a default: it helps debugging anyway, and it feeds the flows for free. The format: OpenTelemetry spans, trimmed to what the map needs (which box called which, in what order).

## What the AI adds

Only meaning: a flow's name, and notes on its steps. These are anchored to boxes like threads, in `.visvet/`, not in the code. The path itself never needs maintaining by hand.

## How it looks

- Boxes on the flow open up so the path shows at every level it crosses; boxes off it collapse.
- The flow's arrows are highlighted and the others fade, as with selection.
- Step through it in order, like a [tour](tours.md), or pan freely.

Flows also exist in the [architecture dimension](architecture-dimension.md): a request crossing services.
