/**
 * Exhaustive Layer-1 interaction capture for Milvus pattern derivation.
 * Accuracy-first: every placement, attach, and traffic edge becomes a record.
 */

import { createHash } from 'crypto';
import {
  ArchitectureEdge,
  ArchitectureNode,
  ArchitecturePayload,
  TrafficRow,
} from './pattern-architecture';
import { ClassifiedResource, PatternDefinition } from './pattern-classifier';

export type InteractionRecord = {
  id: string;
  from_id: string;
  to_id: string;
  from_role: string;
  to_role: string;
  from_label: string;
  to_label: string;
  rel_type: string;
  direction: string;
  port: string;
  protocol: string;
  cidr: string;
  family: string;
  pattern_id: string;
  repo_id: string;
  appsvn: string;
  multi_az: string;
  signals: string;
  /** Canonical text used for embedding — sorted, dense interaction signature. */
  signature: string;
  source: string;
};

function hashId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 48);
}

function roleOf(nodes: Map<string, ArchitectureNode>, id: string): string {
  return nodes.get(id)?.role || 'other';
}

function labelOf(nodes: Map<string, ArchitectureNode>, id: string): string {
  const n = nodes.get(id);
  return n?.label || n?.detail || id;
}

function cidrFromEdge(e: ArchitectureEdge, nodes: Map<string, ArchitectureNode>): string {
  if (e.type === 'ALLOWS_CIDR' || e.direction === 'ingress' || e.direction === 'egress') {
    const to = nodes.get(e.to);
    if (to?.role === 'cidr') return String(to.detail || to.label || '');
    const from = nodes.get(e.from);
    if (from?.role === 'cidr') return String(from.detail || from.label || '');
  }
  if (String(e.to).startsWith('cidr:')) return e.to.replace(/^cidr:/, '');
  return '';
}

/** Build one interaction record from an architecture edge. */
export function edgeToInteraction(
  e: ArchitectureEdge,
  nodes: Map<string, ArchitectureNode>,
  ctx: {
    family: string;
    pattern_id: string;
    repo_id?: string;
    appsvn?: string;
    multi_az?: string;
    signals?: string[];
  },
): InteractionRecord {
  const port = e.port || '';
  const protocol = e.protocol || '';
  const cidr = cidrFromEdge(e, nodes);
  const fromRole = roleOf(nodes, e.from);
  const toRole = roleOf(nodes, e.to);
  const signature = [
    e.type || 'REL',
    e.direction || '',
    fromRole,
    toRole,
    port,
    protocol,
    cidr,
    ctx.family,
    ctx.pattern_id,
    ctx.multi_az || '',
  ]
    .join('|')
    .toLowerCase();

  return {
    id: hashId([ctx.pattern_id, e.from, e.to, e.type, port, protocol, cidr, e.direction || '']),
    from_id: e.from,
    to_id: e.to,
    from_role: fromRole,
    to_role: toRole,
    from_label: labelOf(nodes, e.from),
    to_label: labelOf(nodes, e.to),
    rel_type: e.type || 'RELATES_TO',
    direction: e.direction || '',
    port,
    protocol,
    cidr,
    family: ctx.family,
    pattern_id: ctx.pattern_id,
    repo_id: ctx.repo_id || '',
    appsvn: ctx.appsvn || '',
    multi_az: ctx.multi_az || '',
    signals: (ctx.signals || []).join(','),
    signature,
    source: e.source || 'live',
  };
}

function trafficToInteraction(
  row: TrafficRow,
  patternId: string,
  family: string,
  idx: number,
): InteractionRecord {
  const signature = [
    row.direction,
    'traffic',
    row.port,
    row.protocol,
    row.source,
    row.destination,
    family,
    patternId,
  ]
    .join('|')
    .toLowerCase();
  return {
    id: hashId([patternId, row.direction, row.port, row.protocol, row.source, row.destination, String(idx)]),
    from_id: row.source,
    to_id: row.destination,
    from_role: row.direction === 'ingress' ? 'cidr' : 'workload',
    to_role: row.direction === 'ingress' ? 'workload' : 'cidr',
    from_label: row.source,
    to_label: row.destination,
    rel_type: row.direction === 'ingress' ? 'INGRESS_RULE' : 'EGRESS_RULE',
    direction: row.direction,
    port: row.port,
    protocol: row.protocol,
    cidr: row.direction === 'ingress' ? row.source : row.destination,
    family,
    pattern_id: patternId,
    repo_id: '',
    appsvn: '',
    multi_az: '',
    signals: '',
    signature,
    source: row.source_kind || 'live',
  };
}

/**
 * Exhaustive capture from a composed architecture payload.
 * Includes every edge + every ingress/egress table row (deduped by id).
 */
export function extractInteractionsFromArchitecture(
  arch: ArchitecturePayload,
  instances: ClassifiedResource[] = [],
): InteractionRecord[] {
  const nodeMap = new Map<string, ArchitectureNode>();
  for (const n of arch.nodes || []) nodeMap.set(n.id, n);

  const primary = instances[0];
  const multiAz =
    primary?.attributes?.multi_az != null ? String(primary.attributes.multi_az) : arch.tier === 'complex' ? 'true' : 'false';
  const signals = [...new Set(instances.flatMap((i) => i.signals || []))];
  const repoId = primary?.repo_id || '';
  const appsvn = primary?.appsvn || '';

  const byId = new Map<string, InteractionRecord>();
  for (const e of arch.edges || []) {
    const rec = edgeToInteraction(e, nodeMap, {
      family: arch.family,
      pattern_id: arch.pattern_id,
      repo_id: repoId,
      appsvn: appsvn || undefined,
      multi_az: multiAz,
      signals,
    });
    byId.set(rec.id, rec);
  }

  // Traffic matrix rows — ensure port/protocol/CIDR never dropped even if edge graph thin
  (arch.ingress || []).forEach((row, i) => {
    const rec = trafficToInteraction(row, arch.pattern_id, arch.family, i);
    if (!byId.has(rec.id)) byId.set(rec.id, rec);
  });
  (arch.egress || []).forEach((row, i) => {
    const rec = trafficToInteraction(row, arch.pattern_id, arch.family, 1000 + i);
    if (!byId.has(rec.id)) byId.set(rec.id, rec);
  });

  // HA / DR fact markers as zero-hop interaction signatures (accuracy for pattern matching)
  for (const fact of arch.topology_facts || []) {
    const lower = fact.toLowerCase();
    if (!/multi-az|replica|dr|standby|single-az/.test(lower)) continue;
    const signature = `fact|${arch.family}|${arch.pattern_id}|${lower}`;
    const id = hashId([arch.pattern_id, 'fact', fact]);
    byId.set(id, {
      id,
      from_id: arch.pattern_id,
      to_id: 'topology_fact',
      from_role: 'pattern',
      to_role: 'fact',
      from_label: arch.display_name,
      to_label: fact,
      rel_type: 'TOPOLOGY_FACT',
      direction: 'placement',
      port: '',
      protocol: '',
      cidr: '',
      family: arch.family,
      pattern_id: arch.pattern_id,
      repo_id: repoId,
      appsvn: appsvn || '',
      multi_az: multiAz,
      signals: signals.join(','),
      signature,
      source: 'derived',
    });
  }

  return [...byId.values()];
}

/** Canonical template signatures for Milvus infra_patterns collection. */
export function canonicalPatternSignatures(def: PatternDefinition): InteractionRecord[] {
  const familyPorts: Record<string, { port: string; protocol: string }> = {
    'RDS-PGSQL': { port: '5432', protocol: 'tcp' },
    'RDS-MSSQL': { port: '1433', protocol: 'tcp' },
    'RDS-APGSQL': { port: '5432', protocol: 'tcp' },
    Ec2Oracle: { port: '1521', protocol: 'tcp' },
  };
  const dp = familyPorts[def.family] || { port: '0', protocol: 'tcp' };
  const ha = def.tier === 'complex';
  const baseSigs = [
    `in_vpc|subnet|vpc|${def.family}|${def.pattern_id}`,
    `uses_sg|workload|sg|${def.family}|${def.pattern_id}`,
    `allows_cidr|ingress|${dp.port}|${dp.protocol}|${def.family}|${def.pattern_id}`,
    `allows_cidr|egress|all|all|${def.family}|${def.pattern_id}`,
    ha
      ? `fact|multi-az|ha|${def.family}|${def.pattern_id}`
      : `fact|single-az|std|${def.family}|${def.pattern_id}`,
  ];
  return baseSigs.map((signature, i) => ({
    id: hashId([def.pattern_id, 'canonical', String(i), signature]),
    from_id: def.pattern_id,
    to_id: `canonical:${i}`,
    from_role: 'pattern',
    to_role: 'template',
    from_label: def.display_name,
    to_label: signature,
    rel_type: 'CANONICAL',
    direction: signature.includes('ingress')
      ? 'ingress'
      : signature.includes('egress')
        ? 'egress'
        : 'placement',
    port: signature.includes(dp.port) ? dp.port : '',
    protocol: signature.includes(dp.protocol) ? dp.protocol : '',
    cidr: '',
    family: def.family,
    pattern_id: def.pattern_id,
    repo_id: '',
    appsvn: '',
    multi_az: ha ? 'true' : 'false',
    signals: ha ? 'multi_az,ha' : '',
    signature,
    source: 'canonical',
  }));
}
