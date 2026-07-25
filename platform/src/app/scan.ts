import type { GraphWriter, WatermarkStore, AuditStore } from '../ports/index.ts';
import type { ParsedRepo } from '../domain/parsed.ts';
import { ExecutionPath, pathMayWriteGraph } from '../domain/paths.ts';

// COLD / WARM write side. This is the ONLY place the graph is written and the
// ONLY place indexed_sha advances. HOT never uses this class.
//
// Parsing itself lives in the Go worker; ScanRunner consumes an already-parsed
// repo and performs the graph write + watermark advance in one guarded place.
export interface ScanRunnerDeps {
  graph: GraphWriter;
  watermarks: WatermarkStore;
  audit?: AuditStore;
}

export interface ScanResult {
  path: ExecutionPath;
  nodes: number;
  edges: number;
  indexedSha: string;
}

export class ScanRunner {
  private deps: ScanRunnerDeps;
  constructor(deps: ScanRunnerDeps) {
    this.deps = deps;
  }

  runCold(repoId: string, parsed: ParsedRepo): Promise<ScanResult> {
    return this.run(ExecutionPath.COLD, repoId, parsed, 'full');
  }

  runWarm(repoId: string, parsed: ParsedRepo): Promise<ScanResult> {
    return this.run(ExecutionPath.WARM, repoId, parsed, 'incremental');
  }

  private async run(
    path: ExecutionPath,
    repoId: string,
    parsed: ParsedRepo,
    mode: 'full' | 'incremental',
  ): Promise<ScanResult> {
    // Defensive: enforce doctrine even if called wrongly.
    if (!pathMayWriteGraph(path)) {
      throw new Error(`path ${path} may not write the graph`);
    }
    const stats = await this.deps.graph.write(repoId, parsed, mode);
    await this.deps.watermarks.setIndexedSha(repoId, parsed.headSha);
    if (this.deps.audit) {
      await this.deps.audit.record({
        actor: 'system',
        action: `${path.toLowerCase()} scan completed`,
        target: repoId,
        at: new Date().toISOString(),
      });
    }
    return { path, nodes: stats.nodes, edges: stats.edges, indexedSha: parsed.headSha };
  }
}
