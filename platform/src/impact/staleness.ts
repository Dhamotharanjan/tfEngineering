import type { ModuleContract } from '../domain/contract.ts';
import type { Watermark } from '../domain/watermark.ts';
import type { StalenessInfo } from '../domain/impact.ts';

// Staleness = the graph/contracts we would classify from cannot be trusted for
// this analysis. When stale, the engine returns UNKNOWN and enqueues an async
// WARM refresh; it NEVER rebuilds inline and NEVER writes the graph.
export interface StalenessCheck {
  moduleWatermark: Watermark | null;
  fromContract: ModuleContract | null;
  toContract: ModuleContract | null;
  headSha?: string | null;
}

export function detectStaleness(check: StalenessCheck): StalenessInfo {
  if (!check.fromContract || !check.toContract) {
    return { stale: true, reason: 'missing_contract' };
  }
  const wm = check.moduleWatermark;
  if (!wm || !wm.indexedSha) {
    return { stale: true, reason: 'consumer_not_indexed' };
  }
  // If the module received a HOT event ahead of what the graph has indexed, the
  // graph does not yet reflect the change under analysis.
  if (wm.lastEventSha && wm.indexedSha && wm.lastEventSha !== wm.indexedSha) {
    return { stale: true, reason: 'graph_behind_event' };
  }
  return { stale: false };
}
