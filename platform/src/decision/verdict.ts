import type { ImpactedConsumer, PatternCheck } from '../domain/impact.ts';
import { ImpactClass, PatternVerdict, CheckVerdict } from '../domain/classification.ts';
import type { Policy } from './policy.ts';

// Deterministic decision layer. Turns classified evidence + policy dials into
// exactly one PASS | WARN | BLOCK verdict.
export function computeVerdict(
  consumers: ImpactedConsumer[],
  patternChecks: PatternCheck[],
  policy: Policy,
): CheckVerdict {
  const anyBreaking = consumers.some((c) => c.class === ImpactClass.BREAKING);
  const anyUnknown = consumers.some((c) => c.class === ImpactClass.UNKNOWN);
  const anyDisturbed = patternChecks.some((p) => p.verdict === PatternVerdict.DISTURBED);

  if (anyBreaking && policy.block.onBreaking) return CheckVerdict.BLOCK;
  if (anyDisturbed && policy.block.onDisturbedPattern) return CheckVerdict.BLOCK;
  if (anyUnknown && policy.failClosedOnUnknown) return CheckVerdict.BLOCK;

  if (anyBreaking || anyUnknown || anyDisturbed) return CheckVerdict.WARN;
  return CheckVerdict.PASS;
}
