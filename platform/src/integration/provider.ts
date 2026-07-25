import type { NormalizedVcsEvent } from '../domain/events.ts';

// A VCS provider adapter turns a raw webhook (headers + body) into a normalized
// event. Signature verification is the adapter's responsibility. Core routing
// logic is provider-agnostic and only ever sees NormalizedVcsEvent.
export interface VcsProviderAdapter {
  readonly provider: string;
  // Returns null when the event is not one the loop cares about.
  normalize(input: RawWebhook): NormalizedVcsEvent | null;
  // Verify the payload signature. Throws on failure. No-op adapters must still
  // be explicit about their (lack of) verification.
  verifySignature(input: RawWebhook, secret: string | undefined): void;
}

export interface RawWebhook {
  headers: Record<string, string | undefined>;
  // Raw request body bytes, needed for signature verification.
  rawBody: Buffer | string;
  // Parsed JSON body.
  body: any;
}

export class NotImplementedProviderError extends Error {
  constructor(provider: string) {
    super(`VCS provider adapter not implemented: ${provider}`);
    this.name = 'NotImplementedProviderError';
  }
}
