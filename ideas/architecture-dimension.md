# Architecture dimension

The system above the code: services, containers, databases, queues, and the people who use them.

## C4

The model with users at the top and classes at the bottom is **C4** (Simon Brown, c4model.com). Four zoom levels:

1. **Context:** the system as one box, the **people** who use it (roles like "reviewer", "admin"), and the other systems it talks to.
2. **Containers:** the separately running or deployed things: web app, API server, database, queue.
3. **Components:** the big parts inside one container.
4. **Code:** classes and functions.

visvet's code map is already levels 3 and 4. This dimension adds 1 and 2. Zooming out of the code map could simply carry on into containers, then the context, as one map.

**Teams** aren't in C4 itself. They come from ownership: who owns which system (Backstage's catalog, Team Topologies). Their use is Conway's law: arrows between boxes owned by different teams are the expensive ones, so a team view shows where coordination costs are.

## Where it comes from

Reuse existing formats rather than invent one:

- **Extracted** (the [dimensions](dimensions.md) rule): `docker-compose.yml`, Kubernetes manifests and Terraform already list the containers, ports and links.
- **Declared** for the rest (people, purpose, external systems): **Structurizr DSL** (C4's own "architecture as code") or **LikeC4**, a file in the repo. **Backstage** `catalog-info.yaml` for ownership and teams.

## Across repos

- **First:** each repo describes its own system and names the others it talks to.
- **Later:** a visvet workspace outside any one repo that loads several and renders across them. Needed, since a monorepo can't be a requirement.

[Flows](flows.md) and [tours](tours.md) are just as useful here: a request through the services.
