import type { ConsumerEvidence } from '../domain/impact.ts';
import type { ImpactClass } from '../domain/classification.ts';

// Narration is NARRATION ONLY. It never decides the class and must return
// UNKNOWN framing when evidence is absent. The deterministic class computed by
// the classifier is passed in and MUST be echoed unchanged.
export interface NarrationRequest {
  class: ImpactClass; // authoritative, from the classifier
  evidence: ConsumerEvidence;
}

export interface Narration {
  class: ImpactClass; // echoed, never changed
  headline: string;
  detail: string;
  // True when produced without any LLM (deterministic template).
  grounded: true;
  source: 'template' | 'llm';
}

export interface Narrator {
  narrate(req: NarrationRequest): Promise<Narration>;
}

// PROMPT CONTRACT for any LLM-backed narrator implementation.
// The LLM is given ONLY the evidence record and the pre-computed class, and is
// instructed that it may not change the class and may not invent facts.
export const NARRATION_SYSTEM_PROMPT = [
  'You are a release-impact narrator for infrastructure-as-code changes.',
  'You are given a machine-computed impact CLASS and a structured EVIDENCE record.',
  'Rules:',
  '1. You MUST NOT change the CLASS. Echo it exactly.',
  '2. You MUST only state facts present in EVIDENCE (inputs, versions, file:line).',
  '3. If EVIDENCE lacks a contract diff or is marked stale, describe it as UNKNOWN',
  '   and recommend waiting for the async refresh. Never guess BREAKING/NON_BREAKING.',
  '4. No remediation invented beyond what the evidence supports.',
].join('\n');

export function buildNarrationUserPayload(req: NarrationRequest): Record<string, unknown> {
  // Exactly the fields an LLM is allowed to see. Nothing else.
  return {
    class: req.class,
    module_id: req.evidence.moduleId,
    current_pin: req.evidence.currentPin,
    target_version: req.evidence.targetVersion,
    provided_inputs: req.evidence.providedInputs,
    breaking_reasons: req.evidence.breakingReasons,
    contract_diff_summary: req.evidence.contractDiff?.summary ?? null,
    locations: req.evidence.locations,
    staleness: req.evidence.staleness ?? null,
  };
}
