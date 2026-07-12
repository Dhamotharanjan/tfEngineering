# Architecture Overview

## 1. Ingestion layer
- Connectors for GitHub, GitLab, Azure DevOps, and Bitbucket.
- Event listeners for push, pull request, merge, and repository change events.

## 2. Parsing layer
- Source code parsers for package manifests, imports, and module references.
- Terraform, Terragrunt, Kubernetes, Helm, and CI/CD configuration parsers.

## 3. Knowledge graph layer
- Nodes for repositories, services, modules, cloud resources, teams, and applications.
- Edges for dependency, ownership, runtime, and security relationships.

## 4. AI reasoning layer
- Impact analysis for releases, security findings, and infrastructure changes.
- Upgrade recommendation and remediation workflow generation.

## 5. Delivery layer
- REST and GraphQL APIs for integration.
- Portal dashboards for governance, blast radius, cost, and ownership visibility.
