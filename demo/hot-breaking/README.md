# HOT breaking-impact demo

Synthetic producer/consumer fixtures for a live InfraGraph HOT demo:

- Upstream module contracts: `demo-v1` → `demo-v2` (removes `old_param`, adds mandatory `new_required`)
- Downstream consumers in Neo4j: `demo-consumer-payments`, `demo-consumer-checkout`
- Subscription contacts include `@Dhamotharanjan` as owners

Apply seeds locally (not committed secrets):

```powershell
Get-Content demo/hot-breaking/seed-postgres.sql | docker exec -i tfengineering-postgres psql -U tfengineering -d tfengineering
Get-Content demo/hot-breaking/seed-neo4j.cypher | docker exec -i tfengineering-neo4j cypher-shell -u neo4j -p neo4j123
```
