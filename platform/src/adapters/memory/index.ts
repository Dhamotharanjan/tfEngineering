import type {
  GraphReader,
  GraphWriter,
  ConsumerRef,
  SubscriptionReader,
  WatermarkStore,
  ContractStore,
  PatternStore,
  ImpactReportStore,
  JobEnqueuer,
  AuditStore,
  AuditEntry,
  Notifier,
  Notification,
} from '../../ports/index.ts';
import type { Subscription } from '../../domain/subscription.ts';
import type { Watermark } from '../../domain/watermark.ts';
import type { ModuleContract } from '../../domain/contract.ts';
import type { InfraPattern, PatternStamp } from '../../domain/pattern.ts';
import type { ImpactReport } from '../../domain/impact.ts';
import type { Job } from '../../domain/jobs.ts';
import type { ParsedRepo } from '../../domain/parsed.ts';

// In-memory adapters for tests and local runs. Each mirrors the port contract.
// The Postgres/Neo4j adapters (see src/adapters/postgres, src/adapters/neo4j)
// implement the same interfaces against real stores.

export class MemorySubscriptionReader implements SubscriptionReader {
  private byId = new Map<string, Subscription>();
  constructor(subs: Subscription[] = []) {
    for (const s of subs) this.byId.set(s.id, s);
  }
  add(sub: Subscription): void {
    this.byId.set(sub.id, sub);
  }
  async get(repoId: string): Promise<Subscription | null> {
    return this.byId.get(repoId) ?? null;
  }
  async resolveByFullName(fullName: string): Promise<Subscription | null> {
    for (const s of this.byId.values()) {
      if (s.githubFullName === fullName) return s;
    }
    return null;
  }
  async list(): Promise<Subscription[]> {
    return [...this.byId.values()];
  }
}

export class MemoryWatermarkStore implements WatermarkStore {
  private byId = new Map<string, Watermark>();
  // Records EVERY setIndexedSha call so guard tests can assert HOT never advances it.
  readonly indexedShaWrites: Array<{ repoId: string; sha: string }> = [];
  readonly lastEventShaWrites: Array<{ repoId: string; sha: string }> = [];

  constructor(seed: Watermark[] = []) {
    for (const w of seed) this.byId.set(w.repoId, { ...w });
  }
  async get(repoId: string): Promise<Watermark | null> {
    return this.byId.get(repoId) ?? null;
  }
  async setIndexedSha(repoId: string, sha: string): Promise<void> {
    this.indexedShaWrites.push({ repoId, sha });
    const wm = this.byId.get(repoId) ?? { repoId };
    wm.indexedSha = sha;
    wm.updatedAt = new Date().toISOString();
    this.byId.set(repoId, wm);
  }
  async setLastEventSha(repoId: string, sha: string): Promise<void> {
    this.lastEventShaWrites.push({ repoId, sha });
    const wm = this.byId.get(repoId) ?? { repoId };
    wm.lastEventSha = sha;
    wm.updatedAt = new Date().toISOString();
    this.byId.set(repoId, wm);
  }
}

export class MemoryContractStore implements ContractStore {
  private byKey = new Map<string, ModuleContract>();
  private key(moduleId: string, version: string): string {
    return `${moduleId}@${version}`;
  }
  async get(moduleId: string, version: string): Promise<ModuleContract | null> {
    return this.byKey.get(this.key(moduleId, version)) ?? null;
  }
  async put(contract: ModuleContract): Promise<void> {
    this.byKey.set(this.key(contract.moduleId, contract.version), contract);
  }
}

export class MemoryGraphReader implements GraphReader {
  // consumers keyed by moduleId.
  private consumersByModule = new Map<string, ConsumerRef[]>();
  constructor(seed: Record<string, ConsumerRef[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.consumersByModule.set(k, v);
  }
  setConsumers(moduleId: string, refs: ConsumerRef[]): void {
    this.consumersByModule.set(moduleId, refs);
  }
  async findConsumers(moduleId: string, _sourceMatch: string[]): Promise<ConsumerRef[]> {
    return this.consumersByModule.get(moduleId) ?? [];
  }
  async getProvidedInputs(consumerRepoId: string, moduleId: string): Promise<string[]> {
    const refs = this.consumersByModule.get(moduleId) ?? [];
    const match = refs.find((r) => r.consumerRepoId === consumerRepoId);
    return match ? match.providedInputs : [];
  }
}

// Write side. HOT never receives an instance of this. Records writes so guard
// tests can assert zero graph writes on HOT paths.
export class MemoryGraphWriter implements GraphWriter {
  readonly writes: Array<{ repoId: string; mode: string; headSha: string }> = [];
  async write(repoId: string, parsed: ParsedRepo, mode: 'full' | 'incremental'): Promise<{ nodes: number; edges: number }> {
    this.writes.push({ repoId, mode, headSha: parsed.headSha });
    return { nodes: parsed.modules.length + 1, edges: parsed.modules.length };
  }
}

export class MemoryPatternStore implements PatternStore {
  private patterns = new Map<string, InfraPattern[]>();
  private stamps = new Map<string, PatternStamp[]>();
  setPatterns(moduleId: string, patterns: InfraPattern[]): void {
    this.patterns.set(moduleId, patterns);
  }
  setStamps(patternId: string, stamps: PatternStamp[]): void {
    this.stamps.set(patternId, stamps);
  }
  async patternsForModule(moduleId: string): Promise<InfraPattern[]> {
    return this.patterns.get(moduleId) ?? [];
  }
  async activeStamps(patternId: string): Promise<PatternStamp[]> {
    return (this.stamps.get(patternId) ?? []).filter((s) => s.active);
  }
}

export class MemoryImpactReportStore implements ImpactReportStore {
  private byId = new Map<string, ImpactReport>();
  readonly saved: ImpactReport[] = [];
  async save(report: ImpactReport): Promise<void> {
    this.byId.set(report.reportId, report);
    this.saved.push(report);
  }
  async get(reportId: string): Promise<ImpactReport | null> {
    return this.byId.get(reportId) ?? null;
  }
}

export class MemoryJobEnqueuer implements JobEnqueuer {
  readonly jobs: Job[] = [];
  async enqueue(job: Job): Promise<Job> {
    const withId = job.id ? job : { ...job, id: `job-${this.jobs.length + 1}` };
    this.jobs.push(withId);
    return withId;
  }
}

export class MemoryAuditStore implements AuditStore {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<AuditEntry[]> {
    return [...this.entries];
  }
}

export class MemoryNotifier implements Notifier {
  readonly sent: Notification[] = [];
  async send(notifications: Notification[]): Promise<void> {
    this.sent.push(...notifications);
  }
}
