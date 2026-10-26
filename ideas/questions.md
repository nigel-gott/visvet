# Questions

AI first: a check of understanding doesn't have to be a [koan](learning-tours.md). It can be a question the AI asks, which you answer, and a short back-and-forth follows. That's just a thread.

## In threads

Threads gain Claude Code's question form: a series of questions, each with options to pick from (and "other" for free text). Useful for any thread where the AI needs a decision, not only in tours. The answers arrive back in the thread like a reply.

## In tours

A [tour](tours.md) can stop and need something from you:

- **A choice:** pick from options, and the tour branches. "I built it like this; want the why, or the alternative I rejected?"
- **A check:** "what does this return?", answered in a mini thread embedded in the tour step. Resolve it, then the tour continues.

## Committed or private

The AI decides per thread. A thread that settles a design choice is committed, like any thread. A learning one (a quiz, a tour check) is about you, not the code, so it stays in `.visvet/` outside git, like [fog of war](fog-of-war.md), and can feed it: a question answered well raises familiarity.
