import type { GraphReader, GraphWriter, ConsumerRef } from '../../ports/index.ts';
import type { ParsedRepo } from '../../domain/parsed.ts';
import type { EvidenceLocation } from '../../domain/impact.ts';

// Minimal Cypher runner seam. Wire the neo4j-go-driver equivalent (neo4j-driver
// for Node) here. Injected so this module needs no driver dependency and tests
// stay offline. Read/write session selection is the caller's concern.
export interface CypherRunner {
  read<T = any>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
  write<T = any>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}

// Neo4j-backed GraphReader. Queries mirror the shapes written by
// apps/worker/internal/stages/graph/writer.go (Repository/Stack/Module,
// REFERENCES_MODULE with a `ref` property, USES_MODULE).
export class Neo4jGraphReader implements GraphReader {
  private runner: CypherRunner;
  constructor(runner: CypherRunner) {
    this.runner = runner;
  }

  async findConsumers(moduleId: string, sourceMatch: string[]): Promise<ConsumerRef[]> {
    const rows = await this.runner.read<{
      consumer: string;
      pin: string | null;
      file: string | null;
      line: number | null;
      source: string | null;
    }>(
      `MATCH (consumer:Repository {role: 'downstream_consumer'})-[:HAS_STACK]->(st:Stack)
             -[ref:REFERENCES_MODULE]->(mod:Module)
       WHERE mod.source IN $hints OR ANY(h IN $hints WHERE mod.source CONTAINS h)
       RETURN consumer.id AS consumer, ref.ref AS pin, st.file AS file, ref.line AS line, mod.source AS source`,
      { hints: [moduleId, ...sourceMatch] },
    );
    const byConsumer = new Map<string, ConsumerRef>();
    for (const r of rows) {
      const loc: EvidenceLocation = {
        file: r.file ?? '',
        line: r.line ?? undefined,
        ref: r.pin,
        moduleSource: r.source ?? undefined,
      };
      const existing = byConsumer.get(r.consumer);
      if (existing) {
        existing.locations.push(loc);
        if (!existing.currentPin && r.pin) existing.currentPin = r.pin;
      } else {
        byConsumer.set(r.consumer, {
          consumerRepoId: r.consumer,
          currentPin: r.pin,
          providedInputs: [],
          locations: [loc],
        });
      }
    }
    // Provided inputs come from Postgres config_values in the real system; the
    // caller may enrich, or override getProvidedInputs below.
    return [...byConsumer.values()];
  }

  async getProvidedInputs(consumerRepoId: string, _moduleId: string): Promise<string[]> {
    // In the existing system provided inputs live in Postgres config_values
    // (scope='stack'). This seam returns them from the graph if mirrored there;
    // otherwise wire a Postgres query. Returns empty until wired.
    const rows = await this.runner.read<{ key: string }>(
      `MATCH (r:Repository {id: $id})-[:HAS_STACK]->(:Stack)-[:PROVIDES_INPUT]->(v:Input)
       RETURN DISTINCT v.name AS key`,
      { id: consumerRepoId },
    );
    return rows.map((r) => r.key);
  }
}

// Neo4j-backed GraphWriter — used ONLY by COLD/WARM. Full write logic lives in
// the Go worker; this seam documents the entrypoint for a Node-side writer.
export class Neo4jGraphWriter implements GraphWriter {
  private runner: CypherRunner;
  constructor(runner: CypherRunner) {
    this.runner = runner;
  }
  async write(repoId: string, parsed: ParsedRepo, _mode: 'full' | 'incremental'): Promise<{ nodes: number; edges: number }> {
    await this.runner.write(
      `MERGE (r:Repository {id: $repoId}) SET r.updated_at = datetime()`,
      { repoId },
    );
    // Module upserts + REFERENCES_MODULE edges would follow here, mirroring
    // writer.go. Left as the documented seam; the Go worker is authoritative.
    return { nodes: parsed.modules.length + 1, edges: parsed.modules.length };
  }
}
