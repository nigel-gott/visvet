---
kind: idea
description: How far review lags behind the code: changed lines nobody has reviewed yet, tracked over time.
---
# Review debt

How far review lags behind writing. With AI writing code fast, this is the number that matters: features piling up unreviewed is the real limit.

- **Per box:** lines changed since you last reviewed it. The same data as [fog of war](fog-of-war.md), counted instead of drawn.
- **Overall:** a number in the top bar, and its trend: is debt growing or shrinking this week?
- **A brake for agents:** when debt passes a threshold, the AI stops starting features and offers a review tour of what's unreviewed instead.
