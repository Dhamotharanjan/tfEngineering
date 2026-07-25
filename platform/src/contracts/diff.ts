import type {
  ModuleContract,
  ContractVar,
  ContractOutput,
  ContractDiff,
  VarChangeRecord,
  MadeMandatoryRecord,
} from '../domain/contract.ts';
import { isMandatory } from '../domain/contract.ts';
import { fingerprintContract } from './fingerprint.ts';

function defaultsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Deterministic contract diff. Mirrors the semantics of
// apps/api ReleaseCompareService.diffContracts and worker impact.DiffContracts.
export function diffContracts(from: ModuleContract, to: ModuleContract): ContractDiff {
  const fromVars = new Map(from.variables.map((v) => [v.name, v]));
  const toVars = new Map(to.variables.map((v) => [v.name, v]));

  const added: ContractVar[] = [];
  const removed: ContractVar[] = [];
  const madeMandatory: MadeMandatoryRecord[] = [];
  const changed: VarChangeRecord[] = [];

  for (const [name, tv] of toVars) {
    const fv = fromVars.get(name);
    if (!fv) {
      added.push(tv);
      continue;
    }
    const changes: string[] = [];
    if ((fv.type ?? null) !== (tv.type ?? null)) changes.push('type');
    if (!defaultsEqual(fv.default, tv.default)) changes.push('default');
    if ((fv.description ?? '') !== (tv.description ?? '')) changes.push('description');
    if (Boolean(fv.sensitive) !== Boolean(tv.sensitive)) changes.push('sensitive');

    if (!isMandatory(fv) && isMandatory(tv)) {
      madeMandatory.push({ name });
    } else if (changes.length) {
      changed.push({ name, changes });
    }
  }

  for (const [name, fv] of fromVars) {
    if (!toVars.has(name)) removed.push(fv);
  }

  const fromOut = new Map((from.outputs || []).map((o) => [o.name, o]));
  const toOut = new Map((to.outputs || []).map((o) => [o.name, o]));
  const outputsAdded: ContractOutput[] = [...toOut.values()].filter((o) => !fromOut.has(o.name));
  const outputsRemoved: ContractOutput[] = [...fromOut.values()].filter((o) => !toOut.has(o.name));

  const newRequired = added.filter(isMandatory).length;

  return {
    from: { moduleId: from.moduleId, version: from.version, fingerprint: from.fingerprint ?? fingerprintContract(from) },
    to: { moduleId: to.moduleId, version: to.version, fingerprint: to.fingerprint ?? fingerprintContract(to) },
    variables: { added, removed, madeMandatory, changed },
    outputs: { added: outputsAdded, removed: outputsRemoved },
    summary: {
      added: added.length,
      removed: removed.length,
      madeMandatory: madeMandatory.length,
      changed: changed.length,
      outputsAdded: outputsAdded.length,
      outputsRemoved: outputsRemoved.length,
      newRequired,
    },
  };
}
