import type { Subscription } from '../domain/subscription.ts';

// Resolve a module source string (from a pin) to an internal module repo id.
// Mirrors the worker's graph sourceResolver: match by github_full_name contained
// in the source, else by basename. Purely subscription-driven — no hardcoding.
export class SourceResolver {
  private byGithub = new Map<string, string>();
  private byBasename = new Map<string, string>();

  constructor(subscriptions: Subscription[]) {
    for (const s of subscriptions) {
      this.byBasename.set(s.id, s.id);
      if (s.githubFullName) {
        this.byGithub.set(s.githubFullName, s.id);
        const parts = s.githubFullName.split('/');
        if (parts.length === 2) this.byBasename.set(parts[1], s.id);
      }
    }
  }

  resolve(source: string): string | null {
    if (!source) return null;
    for (const [gh, id] of this.byGithub) {
      if (source.includes(gh)) return id;
    }
    const base = basename(source);
    return this.byBasename.get(base) ?? null;
  }

  // Match hints used for graph fan-out: the module's own id, github name, and
  // any source strings a consumer might use for it.
  matchHints(sub: Subscription): string[] {
    const hints = new Set<string>([sub.id]);
    if (sub.githubFullName) {
      hints.add(sub.githubFullName);
      const parts = sub.githubFullName.split('/');
      if (parts.length === 2) hints.add(parts[1]);
    }
    return [...hints];
  }
}

function basename(source: string): string {
  let s = source.replace(/\/+$/, '');
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  const dslash = s.lastIndexOf('//');
  if (dslash >= 0) s = s.slice(dslash + 2);
  s = s.replace(/^\.\.\//, '').replace(/^\.\//, '');
  const parts = s.split('/');
  const last = parts[parts.length - 1] || s;
  return last.replace(/\.git$/, '');
}
