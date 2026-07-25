import type { ContractDiff } from '../domain/contract.ts';
import { isMandatory } from '../domain/contract.ts';
import type { BreakingReason } from '../domain/impact.ts';
import type { ImpactClass } from '../domain/classification.ts';
import { ImpactClass as Klass } from '../domain/classification.ts';

export interface ClassificationInput {
  contractDiff: ContractDiff | null;
  providedInputs: string[];
  stale: boolean;
}

export interface ClassificationResult {
  class: ImpactClass;
  breakingReasons: BreakingReason[];
}

// DETERMINISTIC classification. AI never runs here.
// Rules (evidence-only):
//   - No contract diff (missing contracts) OR stale graph  -> UNKNOWN
//   - Consumer sets an input that was removed                -> BREAKING
//   - New mandatory input the consumer does not set          -> BREAKING
//   - Input made mandatory that the consumer does not set     -> BREAKING
//   - Type change on an input the consumer sets               -> BREAKING
//   - Otherwise (optional additions / cosmetic / no change)   -> NON_BREAKING
export function classify(input: ClassificationInput): ClassificationResult {
  if (input.stale || !input.contractDiff) {
    return { class: Klass.UNKNOWN, breakingReasons: [] };
  }

  const provided = new Set(input.providedInputs);
  const diff = input.contractDiff;
  const reasons: BreakingReason[] = [];

  for (const v of diff.variables.removed) {
    if (provided.has(v.name)) reasons.push({ kind: 'removed_input_in_use', input: v.name });
  }
  for (const v of diff.variables.added) {
    if (isMandatory(v) && !provided.has(v.name)) {
      reasons.push({ kind: 'new_required_missing', input: v.name });
    }
  }
  for (const m of diff.variables.madeMandatory) {
    if (!provided.has(m.name)) reasons.push({ kind: 'made_mandatory_missing', input: m.name });
  }
  for (const c of diff.variables.changed) {
    if (c.changes.includes('type') && provided.has(c.name)) {
      reasons.push({ kind: 'type_change_in_use', input: c.name });
    }
  }

  if (reasons.length > 0) {
    return { class: Klass.BREAKING, breakingReasons: reasons };
  }
  return { class: Klass.NON_BREAKING, breakingReasons: [] };
}
