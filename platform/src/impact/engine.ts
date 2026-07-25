import { randomUUID } from 'node:crypto';
import type {
  GraphReader,
  SubscriptionReader,
  ContractStore,
  WatermarkStore,
  PatternStore,
  ImpactReportStore,
  JobEnqueuer,
  Notifier,
  ImpactFeedback,
  Notification,
} from '../ports/index.ts';
import type { FileChange } from '../domain/events.ts';
import type {
  ImpactReport,
  ImpactedConsumer,
  ConsumerEvidence,
  PatternCheck,
  EvidenceLocation,
} from '../domain/impact.ts';
import type { ModuleContract, ContractDiff } from '../domain/contract.ts';
import type { Subscription } from '../domain/subscription.ts';
import type { PlatformConfig } from '../config/schema.ts';
import type { Narrator } from '../narration/port.ts';
import { JobIntent, pathForIntent } from '../domain/jobs.ts';
import { ImpactClass, PatternVerdict } from '../domain/classification.ts';
import { diffContracts } from '../contracts/diff.ts';
import { classify } from './classifier.ts';
import { detectStaleness } from './staleness.ts';
import { pinDeltas, hasIaCChange } from './delta.ts';
import { SourceResolver } from './source-resolver.ts';
import { guardPattern, disturbingInputs } from '../pattern/guard.ts';
import { computeVerdict } from '../decision/verdict.ts';
import { resolveRecipients } from '../notify/router.ts';

export interface EngineDeps {
  // NOTE: no GraphWriter here. HOT is structurally read-only.
  graph: GraphReader;
  subscriptions: SubscriptionReader;
  contracts: ContractStore;
  watermarks: WatermarkStore;
  patterns: PatternStore;
  reports: ImpactReportStore;
  jobs: JobEnqueuer;
  notifier: Notifier;
  /** Phase 3: GitHub check run + PR comment (optional; tests may omit). */
  feedback?: ImpactFeedback | null;
  narrator: Narrator;
  config: PlatformConfig;
}

export interface HotQueryInput {
  intent: typeof JobIntent.PR_IMPACT_QUERY | typeof JobIntent.TAG_IMPACT_QUERY;
  repoId: string;
  headSha?: string | null;
  // PR
  files?: FileChange[];
  prNumber?: number;
  prAuthor?: string;
  // TAG (or UI-supplied override versions)
  tag?: string | null;
  fromVersion?: string | null;
  toVersion?: string | null;
}

interface AnalysisUnit {
  moduleId: string;
  consumerRepoId: string;
  fromVersion: string | null;
  toVersion: string | null;
  providedInputs: string[];
  locations: EvidenceLocation[];
}

export class ImpactEngine {
  private deps: EngineDeps;
  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  async runHotQuery(input: HotQueryInput): Promise<ImpactReport> {
    const subs = await this.deps.subscriptions.list();
    const subsById = new Map(subs.map((s) => [s.id, s]));
    const resolver = new SourceResolver(subs);

    const units =
      input.intent === JobIntent.PR_IMPACT_QUERY
        ? await this.buildPrUnits(input, resolver)
        : await this.buildTagUnits(input, subsById.get(input.repoId) ?? null, resolver);

    const reportId = randomUUID();
    const moduleRepoId = input.intent === JobIntent.TAG_IMPACT_QUERY ? input.repoId : units[0]?.moduleId ?? input.repoId;

    // Silence rule: nothing IaC-relevant / no consumers -> no comment.
    if (units.length === 0) {
      return this.finalizeSilent(input, reportId, moduleRepoId);
    }

    const consumers: ImpactedConsumer[] = [];
    const refreshEnqueued: string[] = [];
    const refreshedModules = new Set<string>();
    const diffsByModule = new Map<string, ContractDiff[]>();

    for (const unit of units) {
      const fromContract = unit.fromVersion
        ? await this.deps.contracts.get(unit.moduleId, unit.fromVersion)
        : null;
      const toContract = unit.toVersion ? await this.deps.contracts.get(unit.moduleId, unit.toVersion) : null;
      const moduleWatermark = await this.deps.watermarks.get(unit.moduleId);

      const staleness = detectStaleness({ moduleWatermark, fromContract, toContract, headSha: input.headSha });

      let diff: ContractDiff | null = null;
      if (!staleness.stale && fromContract && toContract) {
        diff = diffContracts(fromContract, toContract);
        const list = diffsByModule.get(unit.moduleId) ?? [];
        list.push(diff);
        diffsByModule.set(unit.moduleId, list);
      }

      if (staleness.stale) {
        // Enqueue an async WARM refresh (once per module). NEVER rebuild inline,
        // NEVER write the graph here.
        if (!refreshedModules.has(unit.moduleId)) {
          refreshedModules.add(unit.moduleId);
          const job = await this.deps.jobs.enqueue({
            intent: JobIntent.WARM_INCREMENTAL,
            path: pathForIntent(JobIntent.WARM_INCREMENTAL),
            priority: 'P1',
            repoId: unit.moduleId,
            payload: { trigger: 'stale_refresh_from_hot', reason: staleness.reason ?? null },
          });
          if (job.id) refreshEnqueued.push(job.id);
        }
      }

      const result = classify({ contractDiff: diff, providedInputs: unit.providedInputs, stale: staleness.stale });

      const evidence: ConsumerEvidence = {
        consumerRepoId: unit.consumerRepoId,
        moduleId: unit.moduleId,
        currentPin: unit.fromVersion,
        targetVersion: unit.toVersion ?? '',
        providedInputs: unit.providedInputs,
        contractDiff: diff,
        breakingReasons: result.breakingReasons,
        locations: unit.locations,
        staleness,
      };

      const narration = await this.deps.narrator.narrate({ class: result.class, evidence });

      consumers.push({ consumerRepoId: unit.consumerRepoId, class: result.class, evidence, narration });
    }

    const patternChecks = await this.buildPatternChecks(moduleRepoId, diffsByModule);

    const verdict = computeVerdict(consumers, patternChecks, this.deps.config.policy);

    const report: ImpactReport = {
      reportId,
      intent: input.intent,
      moduleRepoId,
      fromVersion: input.fromVersion ?? units[0]?.fromVersion ?? null,
      toVersion: input.toVersion ?? input.tag ?? units[0]?.toVersion ?? null,
      prNumber: input.prNumber,
      prAuthor: input.prAuthor,
      headSha: input.headSha ?? null,
      impactExists: true,
      silent: false,
      consumers,
      patternChecks,
      verdict,
      refreshEnqueued,
      generatedAt: new Date().toISOString(),
    };

    await this.deps.reports.save(report);

    // HOT informational watermark ONLY, recorded AFTER analysis so it never
    // makes the current run look stale against itself. NEVER indexed_sha.
    await this.recordEvent(input);

    const notifications = resolveRecipients(report, {
      policy: this.deps.config.policy,
      notifyConfig: this.deps.config.notify,
      baseUrl: this.deps.config.deepLinkBaseUrl,
      subscriptionsById: subsById,
    });
    await this.deliverNotifications(input.repoId, report, notifications);

    return report;
  }

  private async buildPrUnits(input: HotQueryInput, resolver: SourceResolver): Promise<AnalysisUnit[]> {
    if (!hasIaCChange(input.files, this.deps.config.iacExtensions)) return [];
    const deltas = pinDeltas(input.files, this.deps.config.iacExtensions);
    const units: AnalysisUnit[] = [];
    for (const d of deltas) {
      const moduleId = resolver.resolve(d.moduleSource);
      if (!moduleId) continue; // module not subscribed -> cannot analyze
      const providedInputs = await this.deps.graph.getProvidedInputs(input.repoId, moduleId);
      units.push({
        moduleId,
        consumerRepoId: input.repoId,
        fromVersion: input.fromVersion ?? d.fromRef,
        toVersion: input.toVersion ?? d.toRef,
        providedInputs,
        locations: [{ file: d.file, line: d.line, ref: d.toRef, moduleSource: d.moduleSource }],
      });
    }
    return units;
  }

  private async buildTagUnits(
    input: HotQueryInput,
    moduleSub: Subscription | null,
    resolver: SourceResolver,
  ): Promise<AnalysisUnit[]> {
    const moduleId = input.repoId;
    const toVersion = input.toVersion ?? input.tag ?? null;
    const hints = moduleSub ? resolver.matchHints(moduleSub) : [moduleId];
    const consumers = await this.deps.graph.findConsumers(moduleId, hints);
    return consumers.map((c) => ({
      moduleId,
      consumerRepoId: c.consumerRepoId,
      fromVersion: input.fromVersion ?? c.currentPin,
      toVersion,
      providedInputs: c.providedInputs,
      locations: c.locations,
    }));
  }

  private async buildPatternChecks(
    moduleId: string,
    diffsByModule: Map<string, ContractDiff[]>,
  ): Promise<PatternCheck[]> {
    const patterns = await this.deps.patterns.patternsForModule(moduleId);
    const diffs = diffsByModule.get(moduleId) ?? [];
    const checks: PatternCheck[] = [];
    for (const pattern of patterns) {
      const stamps = await this.deps.patterns.activeStamps(pattern.patternId);
      if (diffs.length === 0) {
        checks.push({ patternId: pattern.patternId, verdict: PatternVerdict.UNKNOWN, disturbedInputs: [] });
        continue;
      }
      let verdict: PatternCheck['verdict'] = PatternVerdict.COMPATIBLE;
      const disturbed = new Set<string>();
      for (const diff of diffs) {
        const check = guardPattern(pattern, stamps, diff);
        if (check.verdict === PatternVerdict.DISTURBED) {
          verdict = PatternVerdict.DISTURBED;
          for (const i of check.disturbedInputs) disturbed.add(i);
        }
      }
      checks.push({ patternId: pattern.patternId, verdict, disturbedInputs: [...disturbed] });
    }
    return checks;
  }

  private async finalizeSilent(input: HotQueryInput, reportId: string, moduleRepoId: string): Promise<ImpactReport> {
    const report: ImpactReport = {
      reportId,
      intent: input.intent,
      moduleRepoId,
      fromVersion: input.fromVersion ?? null,
      toVersion: input.toVersion ?? input.tag ?? null,
      prNumber: input.prNumber,
      prAuthor: input.prAuthor,
      headSha: input.headSha ?? null,
      impactExists: false,
      silent: true,
      consumers: [],
      patternChecks: [],
      verdict: 'PASS',
      refreshEnqueued: [],
      generatedAt: new Date().toISOString(),
    };
    await this.deps.reports.save(report);
    await this.recordEvent(input);
    // Silence: no recipient spam; still publish a green/neutral check when feedback is wired.
    await this.deliverNotifications(input.repoId, report, []);
    return report;
  }

  /**
   * Prefer ImpactFeedback (check + comment) when repoFullName resolves from the
   * subscription. Fall back to Notifier.send for recipient-only delivery.
   */
  private async deliverNotifications(
    repoId: string,
    report: ImpactReport,
    notifications: Notification[],
  ): Promise<void> {
    if (this.deps.feedback) {
      const sub = await this.deps.subscriptions.get(repoId);
      if (sub?.githubFullName) {
        await this.deps.feedback.publish({
          report,
          repoFullName: sub.githubFullName,
          notifications,
        });
        return;
      }
    }
    if (notifications.length) await this.deps.notifier.send(notifications);
  }

  // Informational last_event_sha. HOT-only, never advances indexed_sha.
  private async recordEvent(input: HotQueryInput): Promise<void> {
    if (input.headSha) {
      await this.deps.watermarks.setLastEventSha(input.repoId, input.headSha);
    }
  }
}

// Re-export for callers that only need the disturbing-input helper.
export { disturbingInputs };
