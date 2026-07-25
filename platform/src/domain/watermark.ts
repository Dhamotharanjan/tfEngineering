// Dual watermark per repo.
//   indexedSha    : graph truth (= subscriptions.last_scanned_sha). COLD/WARM only.
//   lastEventSha  : informational (= subscriptions.last_event_sha). HOT only.
//   indexedAt     : when indexedSha was last advanced (= subscriptions.indexed_at).
export interface Watermark {
  repoId: string;
  indexedSha?: string | null;
  lastEventSha?: string | null;
  /** ISO timestamp when indexedSha was last advanced (subscriptions.indexed_at). */
  indexedAt?: string | null;
  updatedAt?: string;
}
