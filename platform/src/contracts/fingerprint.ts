import { createHash } from 'node:crypto';
import type { ModuleContract, ContractVar, ContractOutput } from '../domain/contract.ts';
import { isMandatory } from '../domain/contract.ts';

// Deterministic fingerprint of a module interface. NOT an embedding — this is a
// stable content hash used to detect whether the stored contract still matches
// what the graph indexed. Order-independent (sorted) so cosmetic reordering
// does not change the hash.
function normVar(v: ContractVar): string {
  return JSON.stringify({
    name: v.name,
    type: v.type ?? null,
    mandatory: isMandatory(v),
    default: v.default ?? null,
    sensitive: Boolean(v.sensitive),
  });
}

function normOutput(o: ContractOutput): string {
  return JSON.stringify({ name: o.name, sensitive: Boolean(o.sensitive) });
}

export function fingerprintContract(contract: ModuleContract): string {
  const vars = [...contract.variables].map(normVar).sort();
  const outs = [...contract.outputs].map(normOutput).sort();
  const canonical = JSON.stringify({ moduleId: contract.moduleId, vars, outs });
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

export function withFingerprint(contract: ModuleContract): ModuleContract {
  return { ...contract, fingerprint: fingerprintContract(contract) };
}
