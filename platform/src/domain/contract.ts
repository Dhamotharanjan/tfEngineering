// Module interface snapshot for one version, plus a fingerprint hash.
// Shapes intentionally mirror apps/api ContractVar/ContractOutput and the
// worker's contractVar/contractOutput so records line up across systems.

export interface ContractVar {
  name: string;
  type?: string | null;
  // `default` absent/undefined means the variable is mandatory (no default).
  default?: unknown;
  sensitive?: boolean;
  description?: string | null;
}

export interface ContractOutput {
  name: string;
  sensitive?: boolean;
  description?: string | null;
}

export interface ModuleContract {
  moduleId: string;
  version: string;
  moduleSource?: string | null;
  variables: ContractVar[];
  outputs: ContractOutput[];
  // Deterministic fingerprint of the interface (see contracts/fingerprint.ts).
  fingerprint?: string;
}

export function isMandatory(v: ContractVar): boolean {
  return v.default === undefined || v.default === null;
}

// Typed change records produced by the diff engine.
export interface VarChangeRecord {
  name: string;
  changes: string[]; // subset of: type | default | description | sensitive
}

export interface MadeMandatoryRecord {
  name: string;
}

export interface ContractDiff {
  from: { moduleId: string; version: string; fingerprint?: string };
  to: { moduleId: string; version: string; fingerprint?: string };
  variables: {
    added: ContractVar[];
    removed: ContractVar[];
    madeMandatory: MadeMandatoryRecord[];
    changed: VarChangeRecord[];
  };
  outputs: {
    added: ContractOutput[];
    removed: ContractOutput[];
  };
  summary: {
    added: number;
    removed: number;
    madeMandatory: number;
    changed: number;
    outputsAdded: number;
    outputsRemoved: number;
    newRequired: number; // added variables that are mandatory
  };
}
