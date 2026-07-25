// Subscription record. Field names mirror config/repo-subscriptions.json and the
// worker RepoSubscription model so this layer can share the same store.
export type RepoRole = 'module_source' | 'downstream_consumer' | string;

export interface Subscription {
  id: string;
  githubFullName: string;
  role: RepoRole;
  subscribed: boolean;
  appsvn?: string;
  applicationLabel?: string;
  moduleSourcesWatched?: string[];
  complianceScope?: string[];
  // Recipient metadata. e.g. { primary_team, oncall, owners, architect }.
  contacts?: Record<string, string>;
  defaultBranch?: string;
}
