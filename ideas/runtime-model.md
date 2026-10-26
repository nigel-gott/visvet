---
kind: idea
description: A cheap model (Haiku) on an API key for small jobs while you use the app, cached per box version.
---
# Runtime model

Plug in an API key and a small model (Haiku) does quick jobs as you move around. Direct API calls from the visvet server, each small; not `claude -p` sessions.

- Summarise a box the first time you open it, when it has no doc comment.
- Find and trim the doc excerpt for a [code span annotation](code-span-annotations.md).
- Name and describe a [traced flow](flows-from-tracing.md).
- Sort new threads: question, bug, or style nit.
- Explain a debuff in one line: "complex because of the 9-arm match in `walk`".

Answers cached per box version, so each costs once. The key stays local in `.visvet/`, outside git. Heavy work stays in sessions ([setup agent](setup-agent.md)).
