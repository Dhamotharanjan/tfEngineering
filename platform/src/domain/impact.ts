import type { ImpactClass, PatternVerdict, CheckVerdict } from './classification.ts';
import type { ContractDiff } from './contract.ts';
import type { JobIntent } from './jobs.ts';
import type { Narration } from '../narration/port.ts';

// A single pin/source/version delta extracted from a changed file (HOT).
export interface PinDelta {
  moduleSource: string;
  fromRef: string | null;
  toRef: string | null;
  file: string;
  line?: number;
}

// File+line location where a consumer references the changed module.
export interface EvidenceLocation {
  file: string;
  line?: number;
  ref?: string | null;
  moduleSource?: string;
}

// The grounded evidence for one impacted consumer. This is the ONLY thing the
// narrator is allowed to read. If evidence is thin, class must be UNKNOWN.
export interface ConsumerEvidence {
  consumerRepoId: string;
  moduleId: string;
  currentPin: string | null;
  targetVersion: string;
  providedInputs: string[];
  contractDiff?: ContractDiff | null;
  // Concrete reasons behind the class (deterministic, human-readable keys).
  breakingReasons: BreakingReason[];
  locations: EvidenceLocation[];
  staleness?: StalenessInfo;
}

export interface BreakingReason {
  kind: 'removed_input_in_use' | 'new_required_missing' | 'made_mandatory_missing' | 'type_change_in_use';
  input: string;
}

export interface StalenessInfo {
  stale: boolean;
  reason?: 'missing_contract' | 'graph_behind_event' | 'consumer_not_indexed';
}

export interface ImpactedConsumer {
  consumerRepoId: string;
  class: ImpactClass;
  evidence: ConsumerEvidence;
  narration?: Narration;
}

export interface OverrideRecord {
  actor: string;
  reason: string;
  at: string;
  previousVerdict: CheckVerdict;
}

export interface PatternCheck {
  patternId: string;
  verdict: PatternVerdict;
  disturbedInputs: string[];
}

export interface ImpactReport {
  reportId: string;
  intent: JobIntent;
  moduleRepoId: string;
  fromVersion: string | null;
  toVersion: string | null;
  prNumber?: number;
  prAuthor?: string;
  headSha?: string | null;
  // True when there is any IaC-relevant impact worth surfacing.
  impactExists: boolean;
  // When false, no comment / notification should be emitted (silence rule).
  silent: boolean;
  consumers: ImpactedConsumer[];
  patternChecks: PatternCheck[];
  verdict: CheckVerdict;
  // Async refresh jobs enqueued because evidence was stale (never inline writes).
  refreshEnqueued: string[];
  // Set when a failing verdict is overridden. Audited separately.
  override?: OverrideRecord;
  generatedAt: string;
}
