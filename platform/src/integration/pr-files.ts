import type { FileChange, NormalizedVcsEvent } from '../domain/events.ts';
import { VcsEventKind } from '../domain/events.ts';

/**
 * Fetch changed files for a pull request when the webhook payload omits them.
 * Provider-agnostic; GitHub (and later GitLab/…) implement this behind the port.
 */
export interface PrFileFetchRequest {
  /** Provider full name from the webhook (e.g. "owner/name"). Never hardcoded. */
  repoFullName: string;
  prNumber: number;
  headSha?: string | null;
  baseSha?: string | null;
}

export type PrFileFetchFailureReason =
  | 'invalid_request'
  | 'http_error'
  | 'not_configured'
  | 'parse_error';

export type PrFileFetchResult =
  | { ok: true; files: FileChange[] }
  | { ok: false; reason: PrFileFetchFailureReason; status?: number };

export interface PrFileFetcher {
  fetchChangedFiles(req: PrFileFetchRequest): Promise<PrFileFetchResult>;
}

export interface ResolvePrFilesResult {
  event: NormalizedVcsEvent;
  /** True when files were loaded via the fetcher (payload had none). */
  fetched: boolean;
  /** True when a fetch was attempted and failed — caller must not invent paths. */
  fetchFailed: boolean;
}

/**
 * Ensure a PR event has file paths when possible.
 *
 * - Payload already has files → leave unchanged (no network).
 * - Payload omits/empty files → call fetcher when present.
 * - Fetch fails / missing fetcher / missing prNumber → empty files, no invented paths
 *   (HOT silence / insufficient evidence; never UNKNOWN from invented data).
 */
export async function resolvePrFiles(
  event: NormalizedVcsEvent,
  fetcher?: PrFileFetcher | null,
): Promise<ResolvePrFilesResult> {
  if (event.kind !== VcsEventKind.PULL_REQUEST) {
    return { event, fetched: false, fetchFailed: false };
  }
  if (event.files && event.files.length > 0) {
    return { event, fetched: false, fetchFailed: false };
  }
  if (!fetcher || !event.prNumber || !event.repoFullName) {
    return {
      event: { ...event, files: event.files ?? [] },
      fetched: false,
      fetchFailed: false,
    };
  }

  try {
    const result = await fetcher.fetchChangedFiles({
      repoFullName: event.repoFullName,
      prNumber: event.prNumber,
      headSha: event.headSha ?? null,
      baseSha: event.baseSha ?? null,
    });
    if (!result.ok) {
      return {
        event: { ...event, files: [] },
        fetched: false,
        fetchFailed: true,
      };
    }
    return {
      event: { ...event, files: result.files },
      fetched: true,
      fetchFailed: false,
    };
  } catch {
    return {
      event: { ...event, files: [] },
      fetched: false,
      fetchFailed: true,
    };
  }
}
