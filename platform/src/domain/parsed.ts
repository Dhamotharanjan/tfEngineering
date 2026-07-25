// Minimal parsed-repo shape the COLD/WARM write side hands to the GraphWriter.
// The real parser lives in the Go worker (apps/worker/internal/stages/parse);
// this module only needs enough structure to model graph writes + tests.
export interface ParsedModuleRef {
  source: string;
  ref?: string | null;
  file?: string;
}

export interface ParsedRepo {
  repoId: string;
  headSha: string;
  modules: ParsedModuleRef[];
  // Free-form node/edge counts or extras; kept open for adapter needs.
  extras?: Record<string, unknown>;
}
