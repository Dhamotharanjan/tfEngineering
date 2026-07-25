// Provider-agnostic, normalized VCS event. Concrete provider adapters
// (GitHub, GitLab, ...) translate their raw webhook payloads into this shape.
export const VcsEventKind = {
  PUSH: 'push',
  PULL_REQUEST: 'pull_request',
  TAG_RELEASE: 'tag_release',
} as const;

export type VcsEventKind = (typeof VcsEventKind)[keyof typeof VcsEventKind];

// A single changed file with optional before/after contents so delta extraction
// can run fully offline. Contents are supplied by the adapter (from the VCS API
// or the push payload); the core never fetches them itself.
export interface FileChange {
  path: string;
  previousContent?: string | null;
  newContent?: string | null;
  status?: 'added' | 'modified' | 'removed' | 'renamed';
}

export interface NormalizedVcsEvent {
  provider: string;
  kind: VcsEventKind;
  // Repository identity as reported by the provider (e.g. "owner/name").
  // Resolution to an internal repo id happens against the subscription store.
  repoFullName: string;
  deliveryId?: string;
  defaultBranch?: string;
  ref?: string;
  // push: after/before commit shas. pull_request: head/base shas. tag: target sha.
  headSha?: string;
  baseSha?: string;
  // pull_request only
  prNumber?: number;
  prAuthor?: string;
  isDefaultBranch?: boolean;
  // tag_release only
  tag?: string;
  releaseName?: string;
  releaseNotes?: string;
  // Changed files, when the adapter can supply them.
  files?: FileChange[];
}
