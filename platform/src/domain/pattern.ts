// Layer-1 pattern + auditor stamp. Mirrors config/postgres infra_patterns and
// pattern_stamps. A pattern declares which module inputs it depends on
// (guardedInputs); disturbing any of them under an active stamp is a DISTURBED.
export interface InfraPattern {
  patternId: string;
  family: string;
  displayName: string;
  // Module inputs whose removal / type change / made-mandatory would violate the
  // stamped design. Sourced from detection_rules, never hardcoded here.
  guardedInputs: string[];
  // Which module source ids this pattern is stamped against.
  moduleIds: string[];
}

export interface PatternStamp {
  patternId: string;
  auditor: string;
  active: boolean; // revoked_at IS NULL
  complianceFramework?: string;
}
