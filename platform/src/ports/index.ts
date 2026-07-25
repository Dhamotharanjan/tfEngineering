import type { Subscription } from '../domain/subscription.ts';
import type { Watermark } from '../domain/watermark.ts';
import type { ModuleContract } from '../domain/contract.ts';
import type { InfraPattern, PatternStamp } from '../domain/pattern.ts';
import type { ImpactReport, EvidenceLocation } from '../domain/impact.ts';
import type { Job } from '../domain/jobs.ts';
import type { ParsedRepo } from '../domain/parsed.ts';

// Read-only view of a consumer's use of a module, resolved from the graph.
export interface ConsumerRef {
  consumerRepoId: string;
  currentPin: string | null;
  providedInputs: string[];
  locations: EvidenceLocation[];
}

// GraphReader is the ONLY way the HOT engine reaches the dependency graph.
// Swap the Neo4j adapter for the in-memory fake in tests. Read-only by design.
export interface GraphReader {
  // Consumers that reference the given module source id (fan-out).
  findConsumers(moduleId: string, sourceMatch: string[]): Promise<ConsumerRef[]>;
  // Inputs a specific consumer actually supplies to the module.
  getProvidedInputs(consumerRepoId: string, moduleId: string): Promise<string[]>;
}

// GraphWriter is the write side, used ONLY by COLD/WARM. HOT never receives one.
export interface GraphWriter {
  write(repoId: string, parsed: ParsedRepo, mode: 'full' | 'incremental'): Promise<{ nodes: number; edges: number }>;
}

export interface SubscriptionReader {
  get(repoId: string): Promise<Subscription | null>;
  resolveByFullName(fullName: string): Promise<Subscription | null>;
  list(): Promise<Subscription[]>;
}

export interface WatermarkStore {
  get(repoId: string): Promise<Watermark | null>;
  // COLD/WARM only.
  setIndexedSha(repoId: string, sha: string): Promise<void>;
  // HOT only. Informational.
  setLastEventSha(repoId: string, sha: string): Promise<void>;
}

export interface ContractStore {
  get(moduleId: string, version: string): Promise<ModuleContract | null>;
  put(contract: ModuleContract): Promise<void>;
}

export interface PatternStore {
  patternsForModule(moduleId: string): Promise<InfraPattern[]>;
  activeStamps(patternId: string): Promise<PatternStamp[]>;
}

export interface ImpactReportStore {
  save(report: ImpactReport): Promise<void>;
  get(reportId: string): Promise<ImpactReport | null>;
}

export interface JobEnqueuer {
  enqueue(job: Job): Promise<Job>;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target: string;
  reason?: string;
  at: string;
}

export interface AuditStore {
  record(entry: AuditEntry): Promise<void>;
  list(): Promise<AuditEntry[]>;
}

export interface Notification {
  recipient: string;
  role: 'pr_author' | 'consumer_owner' | 'architect';
  reason: string;
  reportId: string;
  deepLink: string;
}

export interface Notifier {
  send(notifications: Notification[]): Promise<void>;
}

/**
 * VCS check-run + PR comment surface for HOT reports (Phase 3).
 * `repoFullName` must come from a Subscription — never hardcode owner/repo.
 */
export interface ImpactFeedbackInput {
  report: ImpactReport;
  repoFullName: string;
  notifications: Notification[];
}

export interface ImpactFeedback {
  publish(input: ImpactFeedbackInput): Promise<void>;
}
