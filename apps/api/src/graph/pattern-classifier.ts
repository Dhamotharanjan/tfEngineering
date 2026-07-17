/**
 * Layer 1 pattern classification — maps scanned resources to audit-friendly
 * pattern ids (PAT-*) by resource family and HA/DR posture.
 */

export type PatternTier = 'simple' | 'complex';

export type ResourceFamily = 'RDS-PGSQL' | 'RDS-MSSQL' | 'RDS-APGSQL' | 'Ec2Oracle';

export const RESOURCE_FAMILIES: {
  id: ResourceFamily;
  label: string;
  description: string;
}[] = [
  {
    id: 'RDS-PGSQL',
    label: 'RDS PostgreSQL',
    description: 'Amazon RDS for PostgreSQL (aws_db_instance engine=postgres)',
  },
  {
    id: 'RDS-MSSQL',
    label: 'RDS SQL Server',
    description: 'Amazon RDS for SQL Server (sqlserver-* engines)',
  },
  {
    id: 'RDS-APGSQL',
    label: 'Aurora PostgreSQL',
    description: 'Amazon Aurora PostgreSQL (clusters / instances)',
  },
  {
    id: 'Ec2Oracle',
    label: 'EC2 Oracle',
    description: 'Oracle workloads on EC2 (ami/tags)',
  },
];

export type PatternDefinition = {
  pattern_id: string;
  family: ResourceFamily;
  display_name: string;
  tier: PatternTier;
  audit_statement: string;
  finops_notes: string;
  architect_summary: string;
};

/** Canonical taxonomy — mirrored in schema.sql seed. */
export const PATTERN_TAXONOMY: PatternDefinition[] = [
  {
    pattern_id: 'PAT-RDS-PGSQL-SINGLE-AZ-STD',
    family: 'RDS-PGSQL',
    display_name: 'PostgreSQL RDS single-AZ standard (no HA)',
    tier: 'simple',
    audit_statement:
      'Control: PostgreSQL RDS deployed single-AZ without Multi-AZ standby or DR replica topology.',
    finops_notes:
      'Lowest RDS HA cost posture; no standby instance charge. Accept residual AZ-failure risk.',
    architect_summary: 'Single writer, one AZ. No Multi-AZ, no cross-region/DR replica.',
  },
  {
    pattern_id: 'PAT-RDS-PGSQL-MULTIAZ-HA',
    family: 'RDS-PGSQL',
    display_name: 'PostgreSQL RDS Multi-AZ HA',
    tier: 'complex',
    audit_statement:
      'Control: PostgreSQL RDS with Multi-AZ synchronous standby and/or DR/read-replica HA extras.',
    finops_notes:
      'HA premium: Multi-AZ standby roughly doubles instance cost; DR replicas add additional capacity.',
    architect_summary: 'Multi-AZ and/or replica/DR topology for PostgreSQL RDS.',
  },
  {
    pattern_id: 'PAT-RDS-MSSQL-SINGLE-AZ-STD',
    family: 'RDS-MSSQL',
    display_name: 'SQL Server RDS single-AZ standard (no HA)',
    tier: 'simple',
    audit_statement: 'Control: SQL Server RDS single-AZ without Multi-AZ or custom DR.',
    finops_notes: 'Standard SQL Server license + single instance; no HA standby spend.',
    architect_summary: 'Single-AZ SQL Server RDS writer only.',
  },
  {
    pattern_id: 'PAT-RDS-MSSQL-MULTIAZ-HA',
    family: 'RDS-MSSQL',
    display_name: 'SQL Server RDS Multi-AZ HA',
    tier: 'complex',
    audit_statement: 'Control: SQL Server RDS Multi-AZ and/or DR/replica HA posture.',
    finops_notes: 'Multi-AZ + SQL Server licensing compounds HA cost; justify for criticality tier.',
    architect_summary: 'Multi-AZ / replica SQL Server RDS topology.',
  },
  {
    pattern_id: 'PAT-RDS-APGSQL-SINGLE-WRITER',
    family: 'RDS-APGSQL',
    display_name: 'Aurora PostgreSQL single-writer (no HA cluster extras)',
    tier: 'simple',
    audit_statement:
      'Control: Aurora PostgreSQL cluster with single writer and no Multi-AZ reader/DR extras.',
    finops_notes: 'Minimal Aurora cluster cost; no reader nodes or cross-AZ HA premium.',
    architect_summary: 'Aurora PG single writer; no additional readers / Multi-AZ HA extras detected.',
  },
  {
    pattern_id: 'PAT-RDS-APGSQL-HA-CLUSTER',
    family: 'RDS-APGSQL',
    display_name: 'Aurora PostgreSQL Multi-AZ HA cluster',
    tier: 'complex',
    audit_statement: 'Control: Aurora PostgreSQL with Multi-AZ and/or reader replicas / custom HA.',
    finops_notes:
      'Reader nodes and Multi-AZ storage/compute increase Aurora spend; maps to HA SLA tier.',
    architect_summary: 'Aurora PG with Multi-AZ and/or reader/DR topology.',
  },
  {
    pattern_id: 'PAT-EC2-ORACLE-SINGLE',
    family: 'Ec2Oracle',
    display_name: 'EC2 Oracle single-instance (no DR pair)',
    tier: 'simple',
    audit_statement: 'Control: Oracle on EC2 as a single instance without a DR/standby pair.',
    finops_notes: 'Single EC2 + attached storage; no idle DR compute cost.',
    architect_summary: 'One Oracle EC2 instance; no DR/standby counterpart detected.',
  },
  {
    pattern_id: 'PAT-EC2-ORACLE-DR-PAIR',
    family: 'Ec2Oracle',
    display_name: 'EC2 Oracle DR pair (primary + standby)',
    tier: 'complex',
    audit_statement: 'Control: Oracle on EC2 with primary/standby DR pair or multi-AZ HA extras.',
    finops_notes:
      'DR standby roughly doubles compute/storage; tag Role=dr-standby for FinOps attribution.',
    architect_summary: 'Primary + DR/standby Oracle EC2 topology across AZ or role tags.',
  },
];

export type ClassifiedResource = {
  resource_id: string;
  repo_id: string;
  address: string;
  type: string;
  name: string;
  appsvn: string | null;
  family: ResourceFamily;
  pattern_id: string;
  tier: PatternTier;
  signals: string[];
  attributes: Record<string, any>;
};

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return null;
}

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function tagsOf(attrs: Record<string, any>): Record<string, string> {
  const raw = attrs?.tags;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = asString(v);
  }
  return out;
}

function engineOf(attrs: Record<string, any>): string {
  return asString(attrs.engine).toLowerCase();
}

function isSqlServer(engine: string): boolean {
  return engine.startsWith('sqlserver') || engine.includes('sqlserver');
}

function isPostgres(engine: string): boolean {
  return engine === 'postgres' || engine === 'postgresql';
}

function isAuroraPostgres(engine: string): boolean {
  return engine === 'aurora-postgresql' || engine === 'aurora-postgres';
}

function azCount(attrs: Record<string, any>): number {
  const azs = attrs.availability_zones;
  if (Array.isArray(azs)) return azs.length;
  if (typeof azs === 'string' && azs.includes(',')) return azs.split(',').length;
  if (attrs.availability_zone) return 1;
  return 0;
}

function hasReplicaSignal(attrs: Record<string, any>, tags: Record<string, string>): boolean {
  if (asString(attrs.replicate_source_db)) return true;
  const role = (tags.Role || tags.role || '').toLowerCase();
  if (role.includes('replica') || role.includes('reader') || role.includes('standby')) return true;
  const ha = (tags.HAPosture || tags.ha_posture || '').toLowerCase();
  if (ha.includes('replica') || ha.includes('reader')) return true;
  return false;
}

function hasDrSignal(attrs: Record<string, any>, tags: Record<string, string>): boolean {
  const role = (tags.Role || tags.role || '').toLowerCase();
  if (role.includes('dr') || role.includes('standby')) return true;
  const dr = (tags.DR || tags.Dr || tags.dr || '').toLowerCase();
  if (dr === 'true' || dr === 'yes' || dr === '1') return true;
  const ha = (tags.HAPosture || '').toLowerCase();
  if (ha.includes('dr') || ha.includes('multi-az-ha') || ha.includes('multiaz')) return true;
  return false;
}

function isComplexRds(attrs: Record<string, any>, tags: Record<string, string>): { complex: boolean; signals: string[] } {
  const signals: string[] = [];
  const multiAz = asBool(attrs.multi_az);
  if (multiAz === true) signals.push('multi_az');
  if (hasReplicaSignal(attrs, tags)) signals.push('replica');
  if (hasDrSignal(attrs, tags)) signals.push('dr');
  if (azCount(attrs) >= 2) signals.push('multi_az_zones');
  const backup = Number(attrs.backup_retention_period);
  if (!Number.isNaN(backup) && backup >= 14 && (multiAz === true || hasReplicaSignal(attrs, tags))) {
    signals.push('extended_backup');
  }
  return { complex: signals.length > 0, signals };
}

function isOracleEc2(type: string, attrs: Record<string, any>, tags: Record<string, string>): boolean {
  if (type !== 'aws_instance') return false;
  const ami = asString(attrs.ami).toLowerCase();
  if (ami.includes('oracle')) return true;
  const engine = (tags.Engine || tags.engine || '').toLowerCase();
  if (engine.includes('oracle')) return true;
  const app = (tags.Application || tags.application || '').toLowerCase();
  if (app === 'oracle' || app.includes('oracle')) return true;
  const family = (tags.PatternFamily || '').toLowerCase();
  if (family === 'ec2oracle') return true;
  return false;
}

function isComplexOracle(attrs: Record<string, any>, tags: Record<string, string>): { complex: boolean; signals: string[] } {
  const signals: string[] = [];
  if (hasDrSignal(attrs, tags)) signals.push('dr');
  const role = (tags.Role || tags.role || '').toLowerCase();
  if (role.includes('standby') || role.includes('dr')) signals.push('standby');
  return { complex: signals.length > 0, signals };
}

function patternFor(family: ResourceFamily, complex: boolean): string {
  const map: Record<ResourceFamily, { simple: string; complex: string }> = {
    'RDS-PGSQL': {
      simple: 'PAT-RDS-PGSQL-SINGLE-AZ-STD',
      complex: 'PAT-RDS-PGSQL-MULTIAZ-HA',
    },
    'RDS-MSSQL': {
      simple: 'PAT-RDS-MSSQL-SINGLE-AZ-STD',
      complex: 'PAT-RDS-MSSQL-MULTIAZ-HA',
    },
    'RDS-APGSQL': {
      simple: 'PAT-RDS-APGSQL-SINGLE-WRITER',
      complex: 'PAT-RDS-APGSQL-HA-CLUSTER',
    },
    Ec2Oracle: {
      simple: 'PAT-EC2-ORACLE-SINGLE',
      complex: 'PAT-EC2-ORACLE-DR-PAIR',
    },
  };
  return complex ? map[family].complex : map[family].simple;
}

export type RawResourceRow = {
  id: string;
  repo_id: string;
  address: string;
  type: string;
  name: string;
  appsvn?: string | null;
  attributes?: Record<string, any> | null;
};

/**
 * Classify a single resource. Returns null when the resource is outside
 * the Layer-1 technical families.
 */
export function classifyResource(row: RawResourceRow): ClassifiedResource | null {
  const attrs = (row.attributes && typeof row.attributes === 'object' ? row.attributes : {}) as Record<
    string,
    any
  >;
  const tags = tagsOf(attrs);
  const type = row.type;
  const engine = engineOf(attrs);

  // Aurora cluster / cluster instance
  if (type === 'aws_rds_cluster' || type === 'aws_rds_cluster_instance') {
    if (!isAuroraPostgres(engine) && type === 'aws_rds_cluster_instance' && !engine) {
      // engine sometimes only on cluster; treat postgres aurora tag
      if ((tags.PatternFamily || '') !== 'RDS-APGSQL') return null;
    } else if (!isAuroraPostgres(engine) && (tags.PatternFamily || '') !== 'RDS-APGSQL') {
      return null;
    }
    const { complex, signals } = isComplexRds(attrs, tags);
    // cluster instances inherit complexity from reader role / multi-AZ parent signals
    const role = (tags.Role || '').toLowerCase();
    const isReader = role.includes('reader') || row.name.toLowerCase().includes('reader');
    const effectiveComplex = complex || isReader || azCount(attrs) >= 2;
    if (isReader && !signals.includes('replica')) signals.push('replica');
    const family: ResourceFamily = 'RDS-APGSQL';
    return {
      resource_id: row.id,
      repo_id: row.repo_id,
      address: row.address,
      type,
      name: row.name,
      appsvn: row.appsvn || null,
      family,
      pattern_id: patternFor(family, effectiveComplex),
      tier: effectiveComplex ? 'complex' : 'simple',
      signals: effectiveComplex ? (signals.length ? signals : ['ha_cluster']) : [],
      attributes: attrs,
    };
  }

  if (type === 'aws_db_instance') {
    let family: ResourceFamily | null = null;
    if (isAuroraPostgres(engine)) family = 'RDS-APGSQL';
    else if (isSqlServer(engine)) family = 'RDS-MSSQL';
    else if (isPostgres(engine)) family = 'RDS-PGSQL';
    else if ((tags.PatternFamily || '') === 'RDS-PGSQL') family = 'RDS-PGSQL';
    else if ((tags.PatternFamily || '') === 'RDS-MSSQL') family = 'RDS-MSSQL';
    else if ((tags.PatternFamily || '') === 'RDS-APGSQL') family = 'RDS-APGSQL';
    if (!family) return null;

    const { complex, signals } = isComplexRds(attrs, tags);
    return {
      resource_id: row.id,
      repo_id: row.repo_id,
      address: row.address,
      type,
      name: row.name,
      appsvn: row.appsvn || null,
      family,
      pattern_id: patternFor(family, complex),
      tier: complex ? 'complex' : 'simple',
      signals,
      attributes: attrs,
    };
  }

  if (isOracleEc2(type, attrs, tags)) {
    const { complex, signals } = isComplexOracle(attrs, tags);
    const family: ResourceFamily = 'Ec2Oracle';
    return {
      resource_id: row.id,
      repo_id: row.repo_id,
      address: row.address,
      type,
      name: row.name,
      appsvn: row.appsvn || null,
      family,
      pattern_id: patternFor(family, complex),
      tier: complex ? 'complex' : 'simple',
      signals,
      attributes: attrs,
    };
  }

  return null;
}

/**
 * Post-pass: if a repo has both primary + DR Oracle instances, promote all
 * Oracle instances in that repo to the DR-pair pattern.
 */
export function applyOracleDrPairPromotion(items: ClassifiedResource[]): ClassifiedResource[] {
  const byRepo = new Map<string, ClassifiedResource[]>();
  for (const item of items) {
    if (item.family !== 'Ec2Oracle') continue;
    if (!byRepo.has(item.repo_id)) byRepo.set(item.repo_id, []);
    byRepo.get(item.repo_id)!.push(item);
  }
  for (const [, group] of byRepo) {
    const hasDr = group.some((g) => g.tier === 'complex' || g.signals.includes('dr') || g.signals.includes('standby'));
    const hasPrimary = group.some((g) => {
      const role = asString(g.attributes?.tags?.Role || g.attributes?.tags?.role).toLowerCase();
      return role.includes('primary') || g.tier === 'simple';
    });
    if (hasDr && group.length >= 2 && hasPrimary) {
      for (const g of group) {
        g.pattern_id = 'PAT-EC2-ORACLE-DR-PAIR';
        g.tier = 'complex';
        if (!g.signals.includes('dr_pair')) g.signals.push('dr_pair');
      }
    }
  }
  return items;
}

/**
 * Post-pass for Aurora: if a cluster has >=2 instances or multi-AZ, mark all
 * related cluster resources as HA cluster pattern.
 */
export function applyAuroraHaPromotion(items: ClassifiedResource[]): ClassifiedResource[] {
  for (const item of items) {
    if (item.family !== 'RDS-APGSQL') continue;
    const name = item.name.toLowerCase();
    const attrs = item.attributes || {};
    const tags = tagsOf(attrs);
    if (
      name.includes('ha') ||
      name.includes('reader') ||
      azCount(attrs) >= 2 ||
      asBool(attrs.multi_az) === true ||
      (tags.HAPosture || '').toLowerCase().includes('ha')
    ) {
      item.pattern_id = 'PAT-RDS-APGSQL-HA-CLUSTER';
      item.tier = 'complex';
      if (!item.signals.includes('ha_cluster')) item.signals.push('ha_cluster');
    }
  }
  return items;
}

export function classifyResources(rows: RawResourceRow[]): ClassifiedResource[] {
  const classified = rows.map(classifyResource).filter((x): x is ClassifiedResource => !!x);
  applyOracleDrPairPromotion(classified);
  applyAuroraHaPromotion(classified);
  return classified;
}

export function taxonomyById(patternId: string): PatternDefinition | undefined {
  return PATTERN_TAXONOMY.find((p) => p.pattern_id === patternId);
}
