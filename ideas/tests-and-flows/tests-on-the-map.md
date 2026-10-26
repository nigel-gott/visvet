---
kind: idea
status: exploring
description: Test arrows hidden until you select a box; where each test enters shows test spam.
---
# Tests on the map

Today tests are invisible by accident: visvet's Rust tests are inline `mod tests` blocks, and the parser skips every inline `mod`. Once they show, their arrows would swamp the real ones.

- **Hidden by default, no toggle:** a box shows a count of the tests that reach it (or a debuff when none do). Selecting it brings its test arrows in, as selection already fades other arrows.
- **Test level:** where each test enters the code, a big box through its [ports](ports.md) or a small private function. Many tests entering the leaves is the "spam of little tests" smell [black-box tests](../dimensions/black-box-tests.md) want to avoid.
- The tests themselves stay ordinary code in the code dimension; their main view is the [behaviour dimension](../dimensions/behaviour-dimension.md).
