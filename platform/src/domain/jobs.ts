import { ExecutionPath } from './paths.ts';

// Job intents the routing layer emits. Names mirror the existing worker job
// vocabulary (full_scan / incremental_scan / mandatory_impact_analysis) but are
// re-expressed around the COLD/WARM/HOT doctrine so HOT can never write the graph.
export const JobIntent = {
  COLD_SCAN: 'cold_scan',
  WARM_INCREMENTAL: 'warm_incremental',
  PR_IMPACT_QUERY: 'pr_impact_query',
  TAG_IMPACT_QUERY: 'tag_impact_query',
} as const;

export type JobIntent = (typeof JobIntent)[keyof typeof JobIntent];

export function pathForIntent(intent: JobIntent): ExecutionPath {
  switch (intent) {
    case JobIntent.COLD_SCAN:
      return ExecutionPath.COLD;
    case JobIntent.WARM_INCREMENTAL:
      return ExecutionPath.WARM;
    case JobIntent.PR_IMPACT_QUERY:
    case JobIntent.TAG_IMPACT_QUERY:
      return ExecutionPath.HOT;
  }
}

export type JobPriority = 'P0' | 'P1' | 'P2';

export interface Job {
  id?: string;
  intent: JobIntent;
  path: ExecutionPath;
  priority: JobPriority;
  repoId: string;
  // Free-form, source-derived payload. Never contains hardcoded demo defaults.
  payload: Record<string, unknown>;
}
