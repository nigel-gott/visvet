---
kind: idea
description: The system above the code: services, containers, people and teams, from compose files and C4 formats.
---
# Architecture dimension

Services, containers, databases, queues, and the people who use them. The [C4 model](c4-model.md) gives its levels; visvet's code map is already C4's bottom two, so this [dimension](../dimensions.md) adds the top two, and zooming out of the code could simply carry on into containers.

Reuse existing formats rather than invent one:

- **Extracted** ([rule](../../extracted-not-drawn.md)): `docker-compose.yml`, Kubernetes manifests and Terraform already list containers, ports and links.
- **Declared** for the rest (people, purpose, external systems): Structurizr DSL (C4's own "architecture as code") or LikeC4, a file in the repo. Backstage `catalog-info.yaml` for teams, which also feeds [ownership](../../box-signals/ownership.md).

Systems usually span repos: see [multi-repo workspace](multi-repo-workspace.md). [Flows](../../tests-and-flows/flows.md) work here too: a request crossing services.
