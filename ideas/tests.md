# Tests

A strong opinion: tests should treat large parts of the system as **black boxes** and describe their **behaviour**, BDD style. If a database is inside the box, the test runs a real one. The old reasons to split unit from integration tests mostly fall away with AI writing them, apart from speed, and integration tests can be fast now.

The visvet [methodology](methodology.md) should encourage this style.

On the map:

- Not one box per test case: too much noise.
- Coverage (🧪) already helps.
- The goal: see each black box with its **public interface as ports** on its edge (a function, its parameters, what it returns) and whether its behaviours pass.
- Writing tests this way should push the code towards clear public interfaces and private insides, which the map then shows.

This may really be its own dimension: the [behaviour dimension](behaviour-dimension.md).

## Tests on the code map

Today they're invisible by accident: visvet's Rust tests are inline `mod tests` blocks, and the parser skips every inline `mod`. No rule hides test edges. Once tests show, their arrows would swamp the real ones.

- **Hidden by default, no toggle:** a box shows a count of the tests that reach it (or a debuff when none do). Selecting the box brings its test arrows in, the same way selection already fades the other arrows.
- **Test level:** for each test, where it enters the code: a big box through its ports, or a small private function. Many tests entering small private boxes is the "spam of little tests" smell, visible as a cluster of test arrows into the leaves.
- **Measured from git:** the philosophy is "if behaviour didn't change, no test should fail". A commit that changes no ports but has to edit tests reveals tests tied to implementation details. visvet can count those per test.
- **The tests themselves** stay in the code dimension as ordinary code. Their main view is the [behaviour dimension](behaviour-dimension.md).

## Possible steps

1. **Ports first, without tests:** a box's ports are the members something outside calls or uses; the rest is private. The map already knows which arrows cross a box's edge, so this can show today, and flags boxes with a messy surface (many things called from outside).
2. **Behaviours from a convention:** each test block names the box it tests, and each test's name is a behaviour, e.g. `describe(Store) → it("hands a user reply back to the AI")`. visvet lists behaviours per box with pass/fail.
3. **Black-box check:** flag tests that reach past a box's ports into its insides.
4. Then a separate [behaviour dimension](behaviour-dimension.md) view.
