/**
 * Maps platform JobIntent → existing worker Redis job types.
 * HOT intents return null: they run inline in the API (never graph-write).
 */
export function platformIntentToWorkerType(
  intent: string,
): 'full_scan' | 'incremental_scan' | null {
  switch (intent) {
    case 'cold_scan':
      return 'full_scan';
    case 'warm_incremental':
      return 'incremental_scan';
    case 'pr_impact_query':
    case 'tag_impact_query':
      return null;
    default:
      return null;
  }
}

/** Snake_case payload keys expected by the Go worker. */
export function toWorkerPayload(platformPayload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...platformPayload };
  const map: Record<string, string> = {
    headSha: 'head_sha',
    baseSha: 'before_sha',
    deliveryId: 'delivery_id',
    prNumber: 'pr_number',
    prAuthor: 'pr_author',
    toVersion: 'to_version',
    fromVersion: 'from_version',
    releaseName: 'release_name',
    releaseNotes: 'release_notes',
  };
  for (const [camel, snake] of Object.entries(map)) {
    if (camel in out && !(snake in out)) {
      out[snake] = out[camel];
    }
  }
  return out;
}
