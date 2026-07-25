// Dual watermark per repo.
//   indexedSha    : graph truth. Advanced ONLY by COLD/WARM writes.
//   lastEventSha  : informational. Recorded by HOT events; never gates the graph.
export interface Watermark {
  repoId: string;
  indexedSha?: string | null;
  lastEventSha?: string | null;
  updatedAt?: string;
}
