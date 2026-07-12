<<<<<<< HEAD
# tfEngineering
TF and TG Engineering Knowledge
=======
# TF Engineering Intelligence Platform

This workspace contains a starter architecture for an AI-powered Engineering Intelligence Platform that connects repositories, infrastructure, security signals, and delivery workflows into a unified engineering knowledge graph.

## Goals
- Discover repository and infrastructure relationships automatically.
- Build a continuously updated graph across code, dependencies, cloud resources, and teams.
- Provide AI-driven impact analysis, security insights, and upgrade recommendations.

## Proposed architecture layers
1. Source connectors for GitHub, GitLab, Azure DevOps, and Bitbucket.
2. Parsers for source code, Terraform, Terragrunt, Kubernetes, Helm, and CI/CD files.
3. Graph and vector stores for relationship modeling and semantic search.
4. AI reasoning services for blast-radius and remediation workflows.
5. APIs and dashboards for engineering operations and self-service analysis.

## Repository structure
- apps/api: REST API for graph queries and orchestration.
- apps/worker: background workers for scanning and enrichment.
- apps/web: engineering portal UI.
- services/ingestor: repository and event ingestion services.
- services/parsers: native parsers for infrastructure and code files.
- services/ai: AI reasoning and recommendations engine.
- infrastructure: Docker, Kubernetes, and Terraform assets.
- docs/architecture: architecture notes and implementation steps.

## Local startup
```bash
docker compose up -d --build
```

Then browse:
- Neo4j browser: http://localhost:7474
- API: http://localhost:8000/docs
- Portal: http://localhost:3000
>>>>>>> 4d42f04 (Initial import: TF and TG Engineering Knowledge)
