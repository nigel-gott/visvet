---
kind: idea
description: Run the tests with tracing (or per-test coverage) and each test produces its flow.
---
# Flows from tracing

A test runs one path through the code, so [flows](flows.md) can be derived, not hand-written:

- **Tracing:** a span tracer (Rust `tracing`, OpenTelemetry) gives the exact call order, for tests and for real runs of the app.
- **Per-test coverage:** `cargo llvm-cov` (and V8 coverage for TypeScript) reports which functions each test ran; joined with the map's call arrows, that's the flow.

So [black-box tests](../dimensions/black-box-tests.md) are both the checks and the flow definitions. The [methodology](../methodology.md) makes OpenTelemetry a default for this reason.
