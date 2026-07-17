/**
 * Layer-1 pattern architecture diagrams for architects + external auditors.
 * Builds a single-shot view: topology nodes, ingress/egress with ports/protocols,
 * and human-readable flow summaries. Live Neo4j/Postgres facts win; seed fills gaps.
 */

import { ClassifiedResource, PatternDefinition, ResourceFamily } from './pattern-classifier';

export type ArchRole =
  | 'vpc'
  | 'subnet'
  | 'sg'
  | 'rds'
  | 'ec2'
  | 'igw'
  | 'nat'
  | 'cidr'
  | 'kms'
  | 'route_table'
  | 'other';

export type ArchDirection = 'ingress' | 'egress' | 'data-path' | 'placement' | 'attach';

export type ArchitectureNode = {
  id: string;
  label: string;
  type: string;
  role: ArchRole;
  detail?: string;
  aws_type?: string;
  facts?: Record<string, string | boolean | number | null>;
  x?: number;
  y?: number;
  source?: 'live' | 'seed';
};

export type ArchitectureEdge = {
  from: string;
  to: string;
  type: string;
  direction: ArchDirection;
  port?: string | null;
  protocol?: string | null;
  label?: string;
  detail?: string;
  source?: 'live' | 'seed';
};

export type TrafficRow = {
  direction: 'ingress' | 'egress';
  port: string;
  protocol: string;
  source: string;
  destination: string;
  via?: string;
  note?: string;
  source_kind?: 'live' | 'seed';
};

export type ArchitecturePayload = {
  pattern_id: string;
  family: ResourceFamily;
  tier: string;
  display_name: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  /** Graph shape compatible with DependencyGraph */
  graph: { nodes: ArchitectureNode[]; edges: ArchitectureEdge[] };
  ingress: TrafficRow[];
  egress: TrafficRow[];
  legend: { id: string; label: string; meaning: string }[];
  flow_summary: string[];
  topology_facts: string[];
  covered_apps: any[];
  stamp: any;
  stamped: boolean;
  instance_count: number;
  sources: { neo4j: boolean; postgres: boolean; seed: boolean };
};

type SgRule = {
  direction: 'ingress' | 'egress';
  from_port: string;
  to_port: string;
  protocol: string;
  cidr_blocks: string[];
  security_groups: string[];
  sg_address?: string;
  sg_name?: string;
};

const DEFAULT_PORTS: Record<ResourceFamily, { port: string; protocol: string; label: string }> = {
  'RDS-PGSQL': { port: '5432', protocol: 'tcp', label: 'PostgreSQL' },
  'RDS-MSSQL': { port: '1433', protocol: 'tcp', label: 'SQL Server' },
  'RDS-APGSQL': { port: '5432', protocol: 'tcp', label: 'Aurora PostgreSQL' },
  Ec2Oracle: { port: '1521', protocol: 'tcp', label: 'Oracle listener' },
};

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return null;
}

function portLabel(from: string, to: string): string {
  if (!from && !to) return 'all';
  if (from === to || !to) return from || to || 'all';
  if (from === '0' && to === '0') return 'all';
  return `${from}-${to}`;
}

function protocolLabel(p: string): string {
  if (!p || p === '-1' || p === 'all') return 'all';
  return p.toLowerCase();
}

/** Extract nested SG ingress/egress from resource attributes (_nested_blocks or flat keys). */
export function extractSgRulesFromAttributes(
  address: string,
  name: string,
  attrs: Record<string, any>,
): SgRule[] {
  const rules: SgRule[] = [];
  const nested = attrs?._nested_blocks;
  const walk = (blocks: any) => {
    if (!blocks || typeof blocks !== 'object') return;
    for (const [, raw] of Object.entries(blocks)) {
      const m = raw as any;
      if (!m || typeof m !== 'object') continue;
      const blockType = asString(m.type).toLowerCase();
      const a = (m.attributes && typeof m.attributes === 'object' ? m.attributes : m) as Record<
        string,
        any
      >;
      if (blockType === 'ingress' || blockType === 'egress') {
        rules.push(ruleFromAttrs(blockType, a, address, name));
      }
      if (m.nested) walk(m.nested);
    }
  };
  if (nested) walk(nested);

  // Flat keys: ingress.0 / egress.0
  for (const [k, v] of Object.entries(attrs || {})) {
    const lower = k.toLowerCase();
    if (!lower.includes('ingress') && !lower.includes('egress')) continue;
    if (typeof v !== 'object' || !v) continue;
    const dir = lower.includes('egress') ? 'egress' : 'ingress';
    const a = ((v as any).attributes || v) as Record<string, any>;
    if (a.from_port != null || a.protocol != null || a.cidr_blocks != null) {
      rules.push(ruleFromAttrs(dir, a, address, name));
    }
  }
  return rules;
}

function ruleFromAttrs(
  direction: 'ingress' | 'egress',
  a: Record<string, any>,
  address: string,
  name: string,
): SgRule {
  const cidrs: string[] = [];
  const rawCidr = a.cidr_blocks ?? a.cidr_block;
  if (Array.isArray(rawCidr)) {
    for (const c of rawCidr) if (typeof c === 'string' && c.includes('/')) cidrs.push(c);
  } else if (typeof rawCidr === 'string' && rawCidr.includes('/')) {
    cidrs.push(rawCidr);
  }
  const sgs: string[] = [];
  for (const key of ['security_groups', 'source_security_group_id']) {
    const raw = a[key];
    if (typeof raw === 'string' && raw) sgs.push(raw);
    if (Array.isArray(raw)) {
      for (const s of raw) if (typeof s === 'string') sgs.push(s);
    }
  }
  return {
    direction,
    from_port: asString(a.from_port) || '0',
    to_port: asString(a.to_port) || asString(a.from_port) || '0',
    protocol: asString(a.protocol) || '-1',
    cidr_blocks: cidrs,
    security_groups: sgs,
    sg_address: address,
    sg_name: name,
  };
}

function roleForAwsType(awsType: string): ArchRole {
  switch (awsType) {
    case 'aws_vpc':
      return 'vpc';
    case 'aws_subnet':
      return 'subnet';
    case 'aws_security_group':
    case 'aws_security_group_rule':
      return 'sg';
    case 'aws_db_instance':
    case 'aws_rds_cluster':
    case 'aws_rds_cluster_instance':
      return 'rds';
    case 'aws_instance':
      return 'ec2';
    case 'aws_internet_gateway':
      return 'igw';
    case 'aws_nat_gateway':
      return 'nat';
    case 'aws_kms_key':
      return 'kms';
    case 'aws_route_table':
    case 'aws_route_table_association':
      return 'route_table';
    default:
      return 'other';
  }
}

function layoutPositions(role: ArchRole, index: number): { x: number; y: number } {
  const lanes: Record<ArchRole, { x: number; y0: number }> = {
    cidr: { x: 60, y0: 80 },
    igw: { x: 200, y0: 40 },
    nat: { x: 320, y0: 40 },
    vpc: { x: 200, y0: 140 },
    subnet: { x: 360, y0: 200 },
    sg: { x: 520, y0: 160 },
    rds: { x: 680, y0: 220 },
    ec2: { x: 680, y0: 220 },
    kms: { x: 820, y0: 100 },
    route_table: { x: 360, y0: 80 },
    other: { x: 500, y0: 320 },
  };
  const lane = lanes[role] || lanes.other;
  return { x: lane.x + (index % 2) * 40, y: lane.y0 + Math.floor(index / 2) * 70 };
}

/** Family-specific seed architecture when live SG/topology is thin. */
export function buildSeedArchitecture(
  def: PatternDefinition,
  instances: ClassifiedResource[],
): { nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; ingress: TrafficRow[]; egress: TrafficRow[]; facts: string[] } {
  const dp = DEFAULT_PORTS[def.family];
  const multiAz = def.tier === 'complex';
  const primary = instances[0];
  const engine =
    asString(primary?.attributes?.engine) ||
    (def.family === 'Ec2Oracle' ? 'oracle' : def.family.includes('MSSQL') ? 'sqlserver' : 'postgres');

  const nodes: ArchitectureNode[] = [];
  const edges: ArchitectureEdge[] = [];
  const ingress: TrafficRow[] = [];
  const egress: TrafficRow[] = [];
  const facts: string[] = [];

  const add = (n: Omit<ArchitectureNode, 'x' | 'y'> & { x?: number; y?: number }) => {
    const pos = n.x != null ? { x: n.x, y: n.y! } : layoutPositions(n.role, nodes.filter((x) => x.role === n.role).length);
    nodes.push({ ...n, ...pos, source: 'seed' });
  };

  add({
    id: 'seed:vpc',
    label: 'VPC core',
    type: 'cloudresource',
    role: 'vpc',
    aws_type: 'aws_vpc',
    detail: 'aws_vpc',
    facts: { cidr: '10.20.0.0/16' },
  });
  add({
    id: 'seed:cidr-vpc',
    label: '10.20.0.0/16',
    type: 'cidrblock',
    role: 'cidr',
    detail: '10.20.0.0/16',
  });
  edges.push({
    from: 'seed:vpc',
    to: 'seed:cidr-vpc',
    type: 'HAS_CIDR',
    direction: 'placement',
    label: 'HAS_CIDR',
    source: 'seed',
  });

  add({
    id: 'seed:subnet-a',
    label: 'Private A · us-east-1a',
    type: 'cloudresource',
    role: 'subnet',
    aws_type: 'aws_subnet',
    detail: 'aws_subnet',
    facts: { cidr: '10.20.1.0/24', az: 'us-east-1a' },
  });
  edges.push({
    from: 'seed:subnet-a',
    to: 'seed:vpc',
    type: 'IN_VPC',
    direction: 'placement',
    label: 'IN_VPC',
    source: 'seed',
  });

  if (multiAz) {
    add({
      id: 'seed:subnet-b',
      label: 'Private B · us-east-1b',
      type: 'cloudresource',
      role: 'subnet',
      aws_type: 'aws_subnet',
      detail: 'aws_subnet',
      facts: { cidr: '10.20.2.0/24', az: 'us-east-1b' },
    });
    edges.push({
      from: 'seed:subnet-b',
      to: 'seed:vpc',
      type: 'IN_VPC',
      direction: 'placement',
      label: 'IN_VPC',
      source: 'seed',
    });
    facts.push('Multi-AZ: subnets in us-east-1a and us-east-1b');
  } else {
    facts.push('Single-AZ placement (private subnet A)');
  }

  add({
    id: 'seed:igw',
    label: 'Internet Gateway',
    type: 'cloudresource',
    role: 'igw',
    aws_type: 'aws_internet_gateway',
    detail: 'aws_internet_gateway',
  });
  edges.push({
    from: 'seed:igw',
    to: 'seed:vpc',
    type: 'IN_VPC',
    direction: 'placement',
    label: 'IN_VPC',
    source: 'seed',
  });

  add({
    id: 'seed:nat',
    label: 'NAT Gateway',
    type: 'cloudresource',
    role: 'nat',
    aws_type: 'aws_nat_gateway',
    detail: 'aws_nat_gateway',
  });
  edges.push({
    from: 'seed:subnet-a',
    to: 'seed:nat',
    type: 'ROUTES_VIA',
    direction: 'egress',
    label: 'egress via NAT',
    protocol: 'all',
    port: 'all',
    source: 'seed',
  });

  add({
    id: 'seed:sg',
    label: def.family.startsWith('RDS') ? 'DB security group' : 'Oracle SG',
    type: 'cloudresource',
    role: 'sg',
    aws_type: 'aws_security_group',
    detail: 'aws_security_group',
  });
  edges.push({
    from: 'seed:sg',
    to: 'seed:vpc',
    type: 'IN_VPC',
    direction: 'placement',
    label: 'IN_VPC',
    source: 'seed',
  });

  const appCidr = '10.0.0.0/8';
  add({
    id: 'seed:cidr-app',
    label: appCidr,
    type: 'cidrblock',
    role: 'cidr',
    detail: appCidr,
  });

  const ingressLabel = `${dp.port}/${dp.protocol}`;
  edges.push({
    from: 'seed:sg',
    to: 'seed:cidr-app',
    type: 'ALLOWS_CIDR',
    direction: 'ingress',
    port: dp.port,
    protocol: dp.protocol,
    label: `INGRESS ${ingressLabel}`,
    detail: `${dp.label} from ${appCidr}`,
    source: 'seed',
  });
  ingress.push({
    direction: 'ingress',
    port: dp.port,
    protocol: dp.protocol,
    source: appCidr,
    destination: def.family.startsWith('RDS') ? 'RDS / cluster' : 'EC2 Oracle',
    via: 'seed:sg',
    note: `${dp.label} client access (seed baseline)`,
    source_kind: 'seed',
  });

  edges.push({
    from: 'seed:sg',
    to: 'seed:cidr-vpc',
    type: 'ALLOWS_CIDR',
    direction: 'egress',
    port: 'all',
    protocol: 'all',
    label: 'EGRESS all',
    detail: '0.0.0.0/0 via NAT path',
    source: 'seed',
  });
  // Represent world egress target
  add({
    id: 'seed:cidr-world',
    label: '0.0.0.0/0',
    type: 'cidrblock',
    role: 'cidr',
    detail: '0.0.0.0/0',
  });
  edges.push({
    from: 'seed:sg',
    to: 'seed:cidr-world',
    type: 'ALLOWS_CIDR',
    direction: 'egress',
    port: 'all',
    protocol: 'all',
    label: 'EGRESS all',
    source: 'seed',
  });
  egress.push({
    direction: 'egress',
    port: 'all',
    protocol: 'all',
    source: def.family.startsWith('RDS') ? 'RDS / cluster' : 'EC2 Oracle',
    destination: '0.0.0.0/0',
    via: 'seed:sg → NAT',
    note: 'Default allow-all egress (seed baseline)',
    source_kind: 'seed',
  });

  const workloadId = 'seed:workload';
  if (def.family === 'Ec2Oracle') {
    add({
      id: workloadId,
      label: primary?.name || 'Oracle EC2',
      type: 'cloudresource',
      role: 'ec2',
      aws_type: 'aws_instance',
      detail: 'aws_instance',
      facts: {
        multi_az: multiAz,
        engine: 'oracle',
        pattern: def.pattern_id,
      },
    });
    if (multiAz) {
      add({
        id: 'seed:workload-dr',
        label: 'Oracle DR standby',
        type: 'cloudresource',
        role: 'ec2',
        aws_type: 'aws_instance',
        detail: 'aws_instance',
        facts: { role: 'dr-standby', az: 'us-east-1b' },
      });
      edges.push({
        from: 'seed:workload-dr',
        to: 'seed:subnet-b',
        type: 'IN_SUBNET',
        direction: 'placement',
        label: 'IN_SUBNET',
        source: 'seed',
      });
      edges.push({
        from: 'seed:workload-dr',
        to: 'seed:sg',
        type: 'USES_SG',
        direction: 'attach',
        label: 'USES_SG',
        source: 'seed',
      });
      facts.push('DR pair: primary + standby across AZs');
    }
  } else {
    add({
      id: workloadId,
      label: primary?.name || (def.family.includes('APGSQL') ? 'Aurora PG' : 'RDS'),
      type: 'cloudresource',
      role: 'rds',
      aws_type: def.family.includes('APGSQL') ? 'aws_rds_cluster' : 'aws_db_instance',
      detail: def.family.includes('APGSQL') ? 'aws_rds_cluster' : 'aws_db_instance',
      facts: {
        multi_az: multiAz,
        engine,
        pattern: def.pattern_id,
      },
    });
    facts.push(multiAz ? 'Multi-AZ HA / standby topology' : 'Single-AZ writer');
  }

  edges.push({
    from: workloadId,
    to: 'seed:subnet-a',
    type: 'IN_SUBNET',
    direction: 'placement',
    label: 'IN_SUBNET',
    source: 'seed',
  });
  edges.push({
    from: workloadId,
    to: 'seed:sg',
    type: 'USES_SG',
    direction: 'attach',
    label: 'USES_SG',
    source: 'seed',
  });
  edges.push({
    from: 'seed:cidr-app',
    to: workloadId,
    type: 'DATA_PATH',
    direction: 'data-path',
    port: dp.port,
    protocol: dp.protocol,
    label: `${dp.port}/${dp.protocol}`,
    detail: `App tier → ${dp.label}`,
    source: 'seed',
  });

  facts.push(`VPC CIDR 10.20.0.0/16`);
  facts.push(`Ingress ${dp.port}/${dp.protocol} from ${appCidr}`);
  facts.push(`Egress all protocols to 0.0.0.0/0 (NAT)`);

  return { nodes, edges, ingress, egress, facts };
}

export type LiveNetworkResource = {
  id: string;
  repo_id: string;
  address: string;
  type: string;
  name: string;
  attributes: Record<string, any>;
};

export type Neo4jTopoEdge = {
  from: string;
  to: string;
  type: string;
  fromLabel?: string;
  toLabel?: string;
  fromDetail?: string;
  toDetail?: string;
  toKind?: string;
};

/**
 * Merge live resources + SG rules + optional Neo4j edges with seed fill for auditors.
 */
export function composeArchitecture(opts: {
  def: PatternDefinition;
  instances: ClassifiedResource[];
  networkResources: LiveNetworkResource[];
  neo4jEdges?: Neo4jTopoEdge[];
  coveredApps?: any[];
  stamp?: any;
}): ArchitecturePayload {
  const { def, instances, networkResources, neo4jEdges = [], coveredApps = [], stamp = null } = opts;
  const seed = buildSeedArchitecture(def, instances);

  const nodes: ArchitectureNode[] = [];
  const edges: ArchitectureEdge[] = [];
  const ingress: TrafficRow[] = [];
  const egress: TrafficRow[] = [];
  const facts: string[] = [];
  const nodeSeen = new Set<string>();
  let liveSgRules = 0;
  let usedNeo4j = false;
  let usedPostgres = networkResources.length > 0 || instances.length > 0;

  const addNode = (n: ArchitectureNode) => {
    if (!n.id || nodeSeen.has(n.id)) return;
    nodeSeen.add(n.id);
    if (n.x == null) {
      const pos = layoutPositions(n.role, nodes.filter((x) => x.role === n.role).length);
      n.x = pos.x;
      n.y = pos.y;
    }
    nodes.push(n);
  };

  // Live workload instances
  for (const inst of instances) {
    const awsType = inst.type;
    const role = roleForAwsType(awsType);
    const multiAz = asBool(inst.attributes?.multi_az);
    const az = asString(inst.attributes?.availability_zone);
    const engine = asString(inst.attributes?.engine);
    addNode({
      id: inst.resource_id,
      label: inst.name,
      type: 'cloudresource',
      role,
      aws_type: awsType,
      detail: awsType,
      facts: {
        multi_az: multiAz,
        availability_zone: az || null,
        engine: engine || null,
        address: inst.address,
      },
      source: 'live',
    });
    if (multiAz === true) facts.push(`${inst.name}: Multi-AZ = true`);
    if (az) facts.push(`${inst.name}: AZ ${az}`);
    if (engine) facts.push(`${inst.name}: engine=${engine}`);
    const azs = inst.attributes?.availability_zones;
    if (Array.isArray(azs) && azs.length >= 2) {
      facts.push(`${inst.name}: availability_zones=[${azs.join(', ')}]`);
    }
  }

  // Live network topology (VPC / subnet / IGW / NAT / route tables) + focused SG rules
  const attachedSgRefs = new Set<string>();
  for (const inst of instances) {
    const sgIds = inst.attributes?.vpc_security_group_ids;
    const list = Array.isArray(sgIds) ? sgIds : sgIds ? [sgIds] : [];
    for (const ref of list) {
      const s = asString(ref);
      if (s) {
        attachedSgRefs.add(normalizeRef(s));
        attachedSgRefs.add(s);
      }
    }
    const single = asString(inst.attributes?.vpc_security_group_id);
    if (single) {
      attachedSgRefs.add(normalizeRef(single));
      attachedSgRefs.add(single);
    }
  }
  const instanceRepoIds = new Set(instances.map((i) => i.repo_id));

  const isAttachedSg = (nr: LiveNetworkResource) =>
    [...attachedSgRefs].some(
      (ref) => ref.includes(nr.address) || nr.address.includes(normalizeRef(ref)) || ref.includes(nr.name),
    );

  const sgRules: SgRule[] = [];
  for (const nr of networkResources) {
    const isSg = nr.type === 'aws_security_group' || nr.type === 'aws_security_group_rule';
    if (isSg) {
      // Defer SG nodes to the focused set below
      continue;
    }
    const role = roleForAwsType(nr.type);
    const factsMap: Record<string, string | boolean | number | null> = { address: nr.address };
    if (nr.attributes?.cidr_block) factsMap.cidr = asString(nr.attributes.cidr_block);
    if (nr.attributes?.availability_zone) factsMap.az = asString(nr.attributes.availability_zone);
    addNode({
      id: nr.id,
      label: nr.name,
      type: 'cloudresource',
      role,
      aws_type: nr.type,
      detail: nr.type,
      facts: factsMap,
      source: 'live',
    });
    if (nr.type === 'aws_vpc' && nr.attributes?.cidr_block) {
      facts.push(`VPC ${nr.name}: ${asString(nr.attributes.cidr_block)}`);
    }
  }

  const sameRepoSgs = networkResources.filter(
    (r) =>
      (r.type === 'aws_security_group' || r.type === 'aws_security_group_rule') &&
      instanceRepoIds.has(r.repo_id),
  );
  const attachedSgs = networkResources.filter(
    (r) =>
      (r.type === 'aws_security_group' || r.type === 'aws_security_group_rule') &&
      attachedSgRefs.size > 0 &&
      isAttachedSg(r),
  );
  // Prefer SGs attached to workloads; else same-repo SGs; else none (seed traffic fills)
  const sgsForRules = attachedSgs.length > 0 ? attachedSgs : sameRepoSgs;
  for (const nr of sgsForRules) {
    addNode({
      id: nr.id,
      label: nr.name,
      type: 'cloudresource',
      role: 'sg',
      aws_type: nr.type,
      detail: nr.type,
      facts: { address: nr.address },
      source: 'live',
    });
    const extracted = extractSgRulesFromAttributes(nr.address, nr.name, nr.attributes || {});
    sgRules.push(...extracted);
    liveSgRules += extracted.length;
  }

  // Placement / attach edges from attributes
  for (const nr of networkResources) {
    const vpcRef = asString(nr.attributes?.vpc_id);
    if (vpcRef && vpcRef.includes('aws_vpc')) {
      const vpc = networkResources.find((r) => vpcRef.includes(r.address) || r.address === normalizeRef(vpcRef));
      if (vpc) {
        edges.push({
          from: nr.id,
          to: vpc.id,
          type: 'IN_VPC',
          direction: 'placement',
          label: 'IN_VPC',
          source: 'live',
        });
      }
    }
  }
  for (const inst of instances) {
    const sgIds = inst.attributes?.vpc_security_group_ids;
    const list = Array.isArray(sgIds) ? sgIds : sgIds ? [sgIds] : [];
    for (const ref of list) {
      const s = asString(ref);
      const sg = networkResources.find(
        (r) => r.type === 'aws_security_group' && (s.includes(r.address) || s.includes(r.name)),
      );
      if (sg) {
        edges.push({
          from: inst.resource_id,
          to: sg.id,
          type: 'USES_SG',
          direction: 'attach',
          label: 'USES_SG',
          source: 'live',
        });
      }
    }
    const subnet = asString(inst.attributes?.subnet_id);
    if (subnet) {
      const sn = networkResources.find((r) => subnet.includes(r.address) || subnet.includes(r.name));
      if (sn) {
        edges.push({
          from: inst.resource_id,
          to: sn.id,
          type: 'IN_SUBNET',
          direction: 'placement',
          label: 'IN_SUBNET',
          source: 'live',
        });
      }
    }
  }

  // Live SG rules → edges + tables (prefer family data-plane port when multiple rules present)
  const familyPort = DEFAULT_PORTS[def.family].port;
  const preferredIngress = sgRules.filter(
    (r) => r.direction === 'ingress' && (r.from_port === familyPort || r.to_port === familyPort),
  );
  const rulesForMatrix = [
    ...(preferredIngress.length ? preferredIngress : sgRules.filter((r) => r.direction === 'ingress')),
    ...sgRules.filter((r) => r.direction === 'egress'),
  ];

  for (const rule of rulesForMatrix) {
    const port = portLabel(rule.from_port, rule.to_port);
    const proto = protocolLabel(rule.protocol);
    const sgNode = networkResources.find((r) => r.address === rule.sg_address);
    const sgId = sgNode?.id || `sg:${rule.sg_address}`;
    if (!sgNode) {
      addNode({
        id: sgId,
        label: rule.sg_name || rule.sg_address || 'SG',
        type: 'cloudresource',
        role: 'sg',
        aws_type: 'aws_security_group',
        detail: 'aws_security_group',
        source: 'live',
      });
    }

    const targets = [
      ...rule.cidr_blocks.map((c) => ({ id: `cidr:${c}`, label: c, kind: 'cidr' as const })),
      ...rule.security_groups.map((s) => ({
        id: `sgref:${s}`,
        label: normalizeRef(s),
        kind: 'sg' as const,
      })),
    ];
    if (!targets.length) {
      targets.push({ id: `cidr:unspecified`, label: '(unspecified)', kind: 'cidr' });
    }

    for (const t of targets) {
      if (t.kind === 'cidr') {
        addNode({
          id: t.id,
          label: t.label,
          type: 'cidrblock',
          role: 'cidr',
          detail: t.label,
          source: 'live',
        });
      }
      edges.push({
        from: sgId,
        to: t.id,
        type: rule.direction === 'ingress' ? 'ALLOWS_CIDR' : 'ALLOWS_CIDR',
        direction: rule.direction,
        port,
        protocol: proto,
        label: `${rule.direction === 'ingress' ? 'INGRESS' : 'EGRESS'} ${port}/${proto}`,
        detail: `${rule.sg_name || rule.sg_address}`,
        source: 'live',
      });
      const row: TrafficRow = {
        direction: rule.direction,
        port,
        protocol: proto,
        source: rule.direction === 'ingress' ? t.label : rule.sg_name || 'workload',
        destination: rule.direction === 'ingress' ? rule.sg_name || 'SG/workload' : t.label,
        via: rule.sg_name || rule.sg_address,
        note: `${rule.from_port}-${rule.to_port}/${proto}`,
        source_kind: 'live',
      };
      if (rule.direction === 'ingress') ingress.push(row);
      else egress.push(row);
    }
  }

  // Neo4j topology edges
  for (const e of neo4jEdges) {
    if (!e.from || !e.to) continue;
    usedNeo4j = true;
    const fromRole = guessRoleFromDetail(e.fromDetail || e.from);
    const toRole =
      String(e.toKind || '').toLowerCase() === 'cidrblock'
        ? 'cidr'
        : guessRoleFromDetail(e.toDetail || e.to);
    addNode({
      id: e.from,
      label: e.fromLabel || shortId(e.from),
      type: 'cloudresource',
      role: fromRole,
      detail: e.fromDetail,
      aws_type: extractAwsType(e.fromDetail || e.from),
      source: 'live',
    });
    addNode({
      id: e.to,
      label: e.toLabel || shortId(e.to),
      type: toRole === 'cidr' ? 'cidrblock' : 'cloudresource',
      role: toRole,
      detail: e.toDetail,
      aws_type: extractAwsType(e.toDetail || e.to),
      source: 'live',
    });
    const dir = directionForRel(e.type);
    edges.push({
      from: e.from,
      to: e.to,
      type: e.type,
      direction: dir,
      label: e.type,
      source: 'live',
    });
  }

  const needSeed = nodes.filter((n) => n.role === 'rds' || n.role === 'ec2').length === 0 ||
    (ingress.length === 0 && egress.length === 0);

  let usedSeed = false;
  if (needSeed || liveSgRules === 0) {
    usedSeed = true;
    // Prefer seed traffic matrix when no live rules
    if (ingress.length === 0) ingress.push(...seed.ingress);
    if (egress.length === 0) egress.push(...seed.egress);
    // Add seed nodes/edges that don't collide with live ids
    for (const n of seed.nodes) {
      if (!nodeSeen.has(n.id)) addNode({ ...n });
    }
    for (const e of seed.edges) {
      if (nodeSeen.has(e.from) && nodeSeen.has(e.to)) {
        // avoid duplicate identical edges
        const dup = edges.some(
          (x) => x.from === e.from && x.to === e.to && x.type === e.type && x.port === e.port,
        );
        if (!dup) edges.push(e);
      }
    }
    for (const f of seed.facts) {
      if (!facts.includes(f)) facts.push(f);
    }
  }

  // If we have live workloads but no SG attach, link first workload to seed SG for readability
  const workloads = nodes.filter((n) => n.role === 'rds' || n.role === 'ec2');
  const sgs = nodes.filter((n) => n.role === 'sg');
  if (workloads.length && sgs.length) {
    for (const w of workloads.slice(0, 3)) {
      const hasAttach = edges.some((e) => e.from === w.id && e.type === 'USES_SG');
      if (!hasAttach) {
        edges.push({
          from: w.id,
          to: sgs[0].id,
          type: 'USES_SG',
          direction: 'attach',
          label: 'USES_SG',
          source: sgs[0].source || 'seed',
        });
      }
    }
  }

  const dp = DEFAULT_PORTS[def.family];
  const flow_summary = [
    `${def.display_name} (${def.pattern_id}) — ${def.tier} tier`,
    `Data plane: clients → SG → ${def.family.startsWith('RDS') ? 'RDS/Aurora' : 'EC2'} on ${dp.port}/${dp.protocol} (${dp.label})`,
    ingress.length
      ? `Ingress: ${ingress.map((r) => `${r.port}/${r.protocol} from ${r.source}`).join('; ')}`
      : 'Ingress: (none detected)',
    egress.length
      ? `Egress: ${egress.map((r) => `${r.port}/${r.protocol} to ${r.destination}`).join('; ')}`
      : 'Egress: (none detected)',
    facts.slice(0, 6).join(' · ') || 'Topology facts derived from classified instances',
  ];

  const legend = [
    { id: 'ingress', label: 'INGRESS', meaning: 'Inbound allow — port/protocol + CIDR or source SG' },
    { id: 'egress', label: 'EGRESS', meaning: 'Outbound allow — port/protocol + destination CIDR/SG' },
    { id: 'uses_sg', label: 'USES_SG', meaning: 'Workload attached to security group' },
    { id: 'in_vpc', label: 'IN_VPC / IN_SUBNET', meaning: 'Placement in VPC or subnet (AZ)' },
    { id: 'data', label: 'DATA_PATH', meaning: 'Application data path with port/protocol' },
    { id: 'nat', label: 'ROUTES_VIA', meaning: 'Private subnet egress via NAT / IGW' },
  ];

  return {
    pattern_id: def.pattern_id,
    family: def.family,
    tier: def.tier,
    display_name: def.display_name,
    nodes,
    edges,
    graph: { nodes, edges },
    ingress,
    egress,
    legend,
    flow_summary,
    topology_facts: facts,
    covered_apps: coveredApps,
    stamp,
    stamped: !!stamp,
    instance_count: instances.length,
    sources: {
      neo4j: usedNeo4j,
      postgres: usedPostgres,
      seed: usedSeed,
    },
  };
}

function normalizeRef(ref: string): string {
  const s = ref.trim().replace(/\.id$/, '').replace(/\[.*?\]/g, '');
  const parts = s.split('.');
  if (parts.length >= 2 && parts[0].startsWith('aws_')) return `${parts[0]}.${parts[1]}`;
  return s;
}

function shortId(id: string): string {
  const s = String(id);
  if (s.includes(':')) return s.split(':').pop() || s;
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

function extractAwsType(detail: string): string | undefined {
  const d = String(detail || '');
  if (d.startsWith('aws_')) return d.split('.')[0];
  const m = d.match(/aws_[a-z0-9_]+/);
  return m ? m[0] : undefined;
}

function guessRoleFromDetail(detail: string): ArchRole {
  const t = extractAwsType(detail) || '';
  if (t) return roleForAwsType(t);
  if (String(detail).includes('/')) return 'cidr';
  return 'other';
}

function directionForRel(rel: string): ArchDirection {
  switch (rel) {
    case 'ALLOWS_CIDR':
    case 'INGRESS_FROM_SG':
      return 'ingress';
    case 'EGRESS_TO_SG':
      return 'egress';
    case 'USES_SG':
    case 'ATTACHED_TO':
      return 'attach';
    case 'IN_VPC':
    case 'IN_SUBNET':
    case 'HAS_CIDR':
    case 'USES_ROUTE_TABLE':
      return 'placement';
    case 'ROUTES_VIA':
      return 'egress';
    default:
      return 'data-path';
  }
}
