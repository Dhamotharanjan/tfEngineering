# Detailed Design

## Domain model
- Repository: code source and metadata.
- Service: business or technical application owned by a team.
- Module: reusable infrastructure or code component.
- Resource: cloud or runtime asset such as a Kubernetes service or Terraform-managed resource.
- Dependency: package, module, or API relationship between entities.
- Team: owning engineering group.

## Data flow
1. Ingest repository metadata from Git providers.
2. Parse file contents into structured facts.
3. Normalize entities and relationships.
4. Enrich with security findings and ownership metadata.
5. Store in Neo4j and PostgreSQL.
6. Query through the API and portal.

## Implementation phases
- Phase 1: local containers and starter services.
- Phase 2: repository ingestion and parsing.
- Phase 3: graph modeling and API layer.
- Phase 4: AI reasoning and dashboard experience.
