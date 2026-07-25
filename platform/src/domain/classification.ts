// Per-consumer HOT classification. Exactly one of these, always.
// Deterministic from evidence; AI never decides the class.
export const ImpactClass = {
  BREAKING: 'BREAKING',
  NON_BREAKING: 'NON_BREAKING',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ImpactClass = (typeof ImpactClass)[keyof typeof ImpactClass];

// Pattern-guard output.
export const PatternVerdict = {
  COMPATIBLE: 'COMPATIBLE',
  DISTURBED: 'DISTURBED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type PatternVerdict = (typeof PatternVerdict)[keyof typeof PatternVerdict];

// Final decision-layer verdict for a HOT check.
export const CheckVerdict = {
  PASS: 'PASS',
  WARN: 'WARN',
  BLOCK: 'BLOCK',
} as const;

export type CheckVerdict = (typeof CheckVerdict)[keyof typeof CheckVerdict];
