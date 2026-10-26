# AI helpers

Today one Claude Code session does the work, through hooks. Two ways to bring in more AI.

## Several sessions

- **An orchestrator:** the main chat hands each new thread to a sub-agent and stays free. Possible now, with only a change to the skill.
- **Seeing them work:** each agent shows on the boxes it's editing right now, like the people in [activity](activity.md). The hooks already know which files an agent touches.

## A cheap model in the background

Plug in an API key and a small model (Haiku) does quick jobs as you move around. Not `claude -p` sessions: direct API calls from the visvet server, each one small.

- Summarise a box the first time you open it, when it has no doc comment.
- Find and trim the doc excerpt for a [learning tour](learning-tours.md) annotation.
- Name and describe a [flow](flows.md) derived from a trace.
- Sort new threads: question, bug, or style nit.
- Explain a debuff in one line: "complex because of the 9-arm match in `walk`".

Answers are cached per box version, so each costs once. The key stays local, in `.visvet/` outside git.
