import type { ContractDiff } from '../domain/contract.ts';
import { isMandatory } from '../domain/contract.ts';
import type { InfraPattern, PatternStamp } from '../domain/pattern.ts';
import type { PatternCheck } from '../domain/impact.ts';
import { PatternVerdict } from '../domain/classification.ts';

// Inputs the change delta touches in a way that could violate a stamped design:
// removed, made-mandatory, type-changed, or newly-required.
export function disturbingInputs(diff: ContractDiff): Set<string> {
  const set = new Set<string>();
  for (const v of diff.variables.removed) set.add(v.name);
  for (const m of diff.variables.madeMandatory) set.add(m.name);
  for (const c of diff.variables.changed) if (c.changes.includes('type')) set.add(c.name);
  for (const v of diff.variables.added) if (isMandatory(v)) set.add(v.name);
  return set;
}

// COMPATIBLE | DISTURBED | UNKNOWN for one pattern.
export function guardPattern(
  pattern: InfraPattern,
  stamps: PatternStamp[],
  diff: ContractDiff | null,
): PatternCheck {
  if (!diff) {
    return { patternId: pattern.patternId, verdict: PatternVerdict.UNKNOWN, disturbedInputs: [] };
  }
  const touched = disturbingInputs(diff);
  const disturbed = pattern.guardedInputs.filter((g) => touched.has(g));
  const hasActiveStamp = stamps.some((s) => s.active);

  if (disturbed.length > 0 && hasActiveStamp) {
    return { patternId: pattern.patternId, verdict: PatternVerdict.DISTURBED, disturbedInputs: disturbed };
  }
  return { patternId: pattern.patternId, verdict: PatternVerdict.COMPATIBLE, disturbedInputs: [] };
}
