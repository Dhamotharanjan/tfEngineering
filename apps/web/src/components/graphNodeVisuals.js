import {
  AlertTriangle,
  Box,
  Database,
  FolderGit2,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Lock,
  Network,
  Package,
  Server,
  Share2,
  Shield,
  ShieldAlert,
  Variable,
} from 'lucide-react';

/** AWS Architecture-style accent colors (approximate official palette). */
const AWS = {
  vpc: { fill: '#7B3FF2', stroke: '#9D6FF7', icon: '#EDE9FE' },
  compute: { fill: '#ED7100', stroke: '#F59E42', icon: '#FFF7ED' },
  database: { fill: '#3B48CC', stroke: '#6366F1', icon: '#EEF2FF' },
  storage: { fill: '#569A31', stroke: '#6BBF47', icon: '#ECFDF5' },
  security: { fill: '#DD344C', stroke: '#F87171', icon: '#FEF2F2' },
  network: { fill: '#8C4FFF', stroke: '#A78BFA', icon: '#F5F3FF' },
  default: { fill: '#FF9900', stroke: '#FFB84D', icon: '#FFF7ED' },
};

const NODE_TYPE_VISUALS = {
  repository: {
    module_source: {
      Icon: FolderGit2,
      label: 'Module source repo',
      fill: '#2563eb',
      stroke: '#60a5fa',
      icon: '#EFF6FF',
    },
    downstream_consumer: {
      Icon: GitBranch,
      label: 'Downstream repo',
      fill: '#0891b2',
      stroke: '#22d3ee',
      icon: '#ECFEFF',
    },
    default: {
      Icon: FolderGit2,
      label: 'Repository',
      fill: '#3b82f6',
      stroke: '#60a5fa',
      icon: '#EFF6FF',
    },
  },
  module: {
    Icon: Package,
    label: 'Module',
    fill: '#9333ea',
    stroke: '#c084fc',
    icon: '#FAF5FF',
  },
  stack: {
    Icon: Layers,
    label: 'Stack',
    fill: '#16a34a',
    stroke: '#4ade80',
    icon: '#F0FDF4',
  },
  datasource: {
    Icon: Database,
    label: 'Data source',
    fill: '#0891b2',
    stroke: '#22d3ee',
    icon: '#ECFEFF',
  },
  variable: {
    Icon: Variable,
    label: 'Variable',
    fill: '#64748b',
    stroke: '#94a3b8',
    icon: '#F8FAFC',
  },
  output: {
    Icon: Share2,
    label: 'Output',
    fill: '#0d9488',
    stroke: '#2dd4bf',
    icon: '#F0FDFA',
  },
  securityfinding: {
    Icon: ShieldAlert,
    label: 'Security finding',
    fill: '#dc2626',
    stroke: '#f87171',
    icon: '#FEF2F2',
  },
  cidrblock: {
    Icon: Globe,
    label: 'CIDR',
    fill: '#ca8a04',
    stroke: '#facc15',
    icon: '#FEFCE8',
  },
  manifest: {
    Icon: Box,
    label: 'Manifest',
    fill: '#ca8a04',
    stroke: '#facc15',
    icon: '#FEFCE8',
  },
};

/** Terraform aws_* type → icon + AWS-style colors. */
const AWS_RESOURCE_VISUALS = {
  aws_vpc: { Icon: Network, label: 'VPC', ...AWS.vpc },
  aws_subnet: { Icon: Share2, label: 'Subnet', ...AWS.network },
  aws_efs_file_system: { Icon: HardDrive, label: 'EFS', ...AWS.storage },
  aws_volume_attachment: { Icon: HardDrive, label: 'EBS Attach', ...AWS.storage },
  aws_internet_gateway: { Icon: Globe, label: 'Internet Gateway', ...AWS.network },
  aws_nat_gateway: { Icon: Network, label: 'NAT Gateway', ...AWS.network },
  aws_route_table: { Icon: Share2, label: 'Route Table', ...AWS.network },
  aws_security_group: { Icon: Shield, label: 'Security Group', ...AWS.security },
  aws_security_group_rule: { Icon: Lock, label: 'SG Rule', ...AWS.security },
  aws_instance: { Icon: Server, label: 'EC2', ...AWS.compute },
  aws_db_instance: { Icon: Database, label: 'RDS', ...AWS.database },
  aws_rds_cluster: { Icon: Database, label: 'RDS Cluster', ...AWS.database },
  aws_rds_cluster_instance: { Icon: Database, label: 'RDS Instance', ...AWS.database },
  aws_s3_bucket: { Icon: HardDrive, label: 'S3', ...AWS.storage },
  aws_ebs_volume: { Icon: HardDrive, label: 'EBS', ...AWS.storage },
  aws_kms_key: { Icon: KeyRound, label: 'KMS', ...AWS.security },
  aws_lambda_function: { Icon: Server, label: 'Lambda', ...AWS.compute },
  aws_eks_cluster: { Icon: Server, label: 'EKS', ...AWS.compute },
};

function normalizeType(type) {
  return String(type || 'stack')
    .toLowerCase()
    .replace(/_/g, '');
}

function extractAwsResourceType(node) {
  const detail = String(node.detail || '').toLowerCase();
  if (detail.startsWith('aws_')) return detail.split('.')[0];

  const id = String(node.id || '');
  const colon = id.indexOf(':');
  if (colon >= 0) {
    const addr = id.slice(colon + 1);
    const typePart = addr.split('.')[0];
    if (typePart.startsWith('aws_')) return typePart;
  }

  const label = String(node.label || '').toLowerCase();
  if (label.startsWith('aws_')) return label.split('.')[0];

  return null;
}

function repositoryRole(node) {
  const detail = String(node.detail || '').toLowerCase();
  if (detail.includes('module_source') || detail.includes('module source')) return 'module_source';
  if (detail.includes('downstream_consumer') || detail.includes('downstream')) return 'downstream_consumer';
  if (String(node.id || '').startsWith('upstream-')) return 'module_source';
  if (String(node.id || '').startsWith('team-') || String(node.id || '').startsWith('repo-')) {
    return 'downstream_consumer';
  }
  return 'default';
}

export function resolveNodeVisual(node) {
  const type = normalizeType(node.type);

  if (type === 'cloudresource') {
    const awsType = extractAwsResourceType(node);
    const hit = awsType && AWS_RESOURCE_VISUALS[awsType];
    if (hit) {
      return {
        ...hit,
        awsType,
        kind: 'aws',
      };
    }
    return {
      Icon: Server,
      label: awsType || 'Cloud resource',
      ...AWS.default,
      awsType,
      kind: 'aws',
    };
  }

  if (type === 'repository') {
    const role = repositoryRole(node);
    const repoVisual = NODE_TYPE_VISUALS.repository[role] || NODE_TYPE_VISUALS.repository.default;
    return { ...repoVisual, role, kind: 'repository' };
  }

  const base = NODE_TYPE_VISUALS[type] || NODE_TYPE_VISUALS.stack;
  return { ...base, kind: type };
}

export function nodeIconSize(type) {
  const t = normalizeType(type);
  if (t === 'repository') return 22;
  if (t === 'module') return 20;
  if (t === 'stack') return 18;
  if (t === 'cloudresource') return 18;
  return 16;
}

export function formatNodeTypeLabel(node) {
  const visual = resolveNodeVisual(node);
  if (visual.awsType) return visual.label || visual.awsType;
  return visual.label || normalizeType(node.type);
}

export { normalizeType, NODE_TYPE_VISUALS, AWS_RESOURCE_VISUALS };
