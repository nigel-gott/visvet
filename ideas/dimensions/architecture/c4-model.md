---
kind: idea
description: C4: four zoom levels from people and systems down to classes; the source of the 'users at the top' diagrams.
---
# C4 model

By Simon Brown (c4model.com). Four zoom levels:

1. **Context:** the system as one box, the **people** who use it (roles like "reviewer", "admin"), and the other systems it talks to.
2. **Containers:** the separately running or deployed things: web app, API server, database, queue.
3. **Components:** the big parts inside one container.
4. **Code:** classes and functions.

**Teams** aren't in C4 itself; they come from ownership (Backstage's catalog, Team Topologies). Their use is Conway's law: arrows between boxes owned by different teams are the costly ones.

Used by the [architecture dimension](architecture-dimension.md).
