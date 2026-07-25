// Three execution paths of the impact loop. One engine, three entrypoints.
//   COLD: subscribe / full scan / reconcile -> WRITE graph -> set indexed_sha
//   WARM: push to default branch -> incremental WRITE graph -> advance indexed_sha
//   HOT : pull_request / tag-release / (later) pre-apply -> READ ONLY, never writes graph
export const ExecutionPath = {
  COLD: 'COLD',
  WARM: 'WARM',
  HOT: 'HOT',
} as const;

export type ExecutionPath = (typeof ExecutionPath)[keyof typeof ExecutionPath];

// Whether a path is permitted to mutate the dependency graph / advance indexed_sha.
export function pathMayWriteGraph(path: ExecutionPath): boolean {
  return path === ExecutionPath.COLD || path === ExecutionPath.WARM;
}
