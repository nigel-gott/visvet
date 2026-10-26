---
kind: idea
description: Smaller signals worth a debuff: smells you can count, slow spans, vulnerable dependencies.
---
# Countable signals

- **Smells you can count:** `unwrap`/`unsafe`/`any`, TODO and FIXME, a wide public surface ([ports](ports.md)).
- **From traces:** slow spans and hot paths, once [flows](flows-from-tracing.md) exist.
- **External dependencies:** outdated versions or known vulnerabilities (`cargo audit`, `npm audit`); see the [dependencies dimension](dependencies-dimension.md).

Debuffs, per the [visual channels](visual-channels.md) rule.
