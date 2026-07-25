import type { VcsProviderAdapter, RawWebhook } from '../provider.ts';
import { NotImplementedProviderError } from '../provider.ts';
import type { NormalizedVcsEvent } from '../../domain/events.ts';

// Clean seams for other providers. These intentionally throw rather than
// pretend to work, so nothing silently mis-routes. Implement normalize/verify
// against each provider's webhook contract when adding real support.
class StubAdapter implements VcsProviderAdapter {
  readonly provider: string;
  constructor(provider: string) {
    this.provider = provider;
  }
  verifySignature(_input: RawWebhook, _secret: string | undefined): void {
    throw new NotImplementedProviderError(this.provider);
  }
  normalize(_input: RawWebhook): NormalizedVcsEvent | null {
    throw new NotImplementedProviderError(this.provider);
  }
}

export class GitLabAdapter extends StubAdapter {
  constructor() {
    super('gitlab');
  }
}

export class AzureDevOpsAdapter extends StubAdapter {
  constructor() {
    super('azure_devops');
  }
}

export class BitbucketAdapter extends StubAdapter {
  constructor() {
    super('bitbucket');
  }
}
