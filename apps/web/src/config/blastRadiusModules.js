/** Maps UI module slugs to Neo4j / API module IDs from scanned sample repos. */
export const MODULE_CATALOG = [
  {
    slug: 'modules-vpc',
    moduleId: 'git::ssh://git.example.com/core-modules/aws-network//vpc?ref=v2026.07.0',
    label: 'Network — VPC / EC2 bastion',
    defaultRepoId: 'upstream-core-network-modules',
  },
  {
    slug: 'modules-rds',
    moduleId: 'git::ssh://git.example.com/core-modules/aws-database//rds?ref=v2026.07.0',
    label: 'Database — RDS / Oracle EC2 / EBS',
    defaultRepoId: 'upstream-core-database-modules',
  },
  {
    slug: 'modules-storage',
    moduleId: 'git::ssh://git.example.com/core-modules/aws-storage//foundation?ref=v2026.07.0',
    label: 'Storage — S3 / EBS / EFS / KMS',
    defaultRepoId: 'upstream-core-storage-modules',
  },
  {
    slug: 'modules-checkout',
    moduleId: 'git::ssh://git.example.com/terraform-modules//s3?ref=v1.0.0',
    label: 'Checkout app — S3 / EC2 / EBS',
    defaultRepoId: 'repo-a',
  },
  {
    slug: 'modules-local-vpc',
    moduleId: '../upstream-core-network-modules',
    label: 'Local path — upstream VPC',
    defaultRepoId: 'team-database-platform-infra',
  },
];

export const DEFAULT_MODULE_SLUG = 'modules-vpc';

export function resolveBlastRadiusModule(slugOrModuleId) {
  const key = slugOrModuleId || DEFAULT_MODULE_SLUG;
  const hit = MODULE_CATALOG.find(
    (m) => m.slug === key || m.moduleId === key || key.startsWith(m.moduleId),
  );
  return hit || { slug: key, moduleId: key, label: key, defaultRepoId: '' };
}

export function moduleSlugForRepo(repoId) {
  const hit = MODULE_CATALOG.find((m) => m.defaultRepoId === repoId);
  return hit?.slug || DEFAULT_MODULE_SLUG;
}

export function defaultRepoForModuleSlug(slug) {
  return resolveBlastRadiusModule(slug).defaultRepoId || 'upstream-core-network-modules';
}

/** Build Blast Radius URL for a tree/repo click (upstream↔downstream lineage). */
export function blastRadiusPathForRepo(repoId, opts = {}) {
  const slug = moduleSlugForRepo(repoId);
  const slice = opts.slice || 'lineage';
  const params = new URLSearchParams();
  if (repoId) params.set('repoId', repoId);
  params.set('slice', slice);
  if (opts.depth != null) params.set('depth', String(opts.depth));
  return `/impact/${slug}?${params.toString()}`;
}
