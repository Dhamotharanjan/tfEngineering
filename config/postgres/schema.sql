-- InfraGraph PostgreSQL schema (idempotent)

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  github_full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  subscribed BOOLEAN NOT NULL DEFAULT false,
  entitlement_tier TEXT,
  scan_profile TEXT,
  local_path TEXT,
  -- Layer 2: application identity (APPSVN). Multiple repos may share one APPSVN.
  appsvn TEXT,
  application_label TEXT,
  triggers_enabled JSONB DEFAULT '{}',
  module_sources_watched JSONB DEFAULT '[]',
  aws_accounts_linked JSONB DEFAULT '[]',
  compliance_scope JSONB DEFAULT '[]',
  contacts JSONB DEFAULT '{}',
  eol_tracking JSONB DEFAULT '{}',
  last_scan_at TIMESTAMPTZ,
  last_scan_status TEXT,
  graph_node_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2',
  repo_id TEXT REFERENCES subscriptions(id),
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES scan_jobs(id),
  repo_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  nodes_written INTEGER DEFAULT 0,
  edges_written INTEGER DEFAULT 0,
  duration_ms INTEGER,
  artifact_path TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS change_plans (
  id TEXT PRIMARY KEY,
  upstream_module TEXT NOT NULL,
  from_version TEXT,
  to_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  phases JSONB NOT NULL DEFAULT '[]',
  rollback TEXT,
  pre_checks JSONB DEFAULT '[]',
  notifications JSONB DEFAULT '[]',
  evidence JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rollout_plans (
  id TEXT PRIMARY KEY,
  change_plan_id TEXT REFERENCES change_plans(id),
  downstream_repo TEXT NOT NULL,
  pinned_version TEXT,
  target_version TEXT NOT NULL,
  strategy TEXT NOT NULL,
  strategy_reason TEXT,
  version_gap TEXT,
  phases JSONB NOT NULL DEFAULT '[]',
  breaking_changes JSONB DEFAULT '[]',
  mock_outputs_drift JSONB DEFAULT '[]',
  rollback TEXT,
  finops_delta_usd NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lifecycle_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  plan_steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eol_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  resource_ref TEXT NOT NULL,
  resource_type TEXT,
  current_version TEXT,
  risk TEXT,
  monthly_cost_usd NUMERIC,
  action TEXT,
  detected_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pattern_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  affected_repos JSONB DEFAULT '[]',
  evidence JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_time TIMESTAMPTZ DEFAULT now(),
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  source_ip TEXT,
  details JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS embedding_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  milvus_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  service_id TEXT,
  -- Inherited from repo appsvn or resource tags.APPSVN when present
  appsvn TEXT,
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'depends_on',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS module_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  stack_file TEXT,
  module_source TEXT NOT NULL,
  ref TEXT,
  version TEXT,
  file TEXT,
  line INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stack_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  stack_file TEXT NOT NULL,
  depends_on_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json JSONB,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upstream_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_repo_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  upstream_repo_id TEXT NOT NULL,
  depth INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_rollout_plans_repo ON rollout_plans(downstream_repo);
CREATE INDEX IF NOT EXISTS idx_eol_risks_repo ON eol_risks(repo_id);
CREATE INDEX IF NOT EXISTS idx_resources_repo ON resources(repo_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_appsvn ON subscriptions(appsvn);
CREATE INDEX IF NOT EXISTS idx_resources_appsvn ON resources(appsvn);
CREATE INDEX IF NOT EXISTS idx_resource_deps_repo ON resource_dependencies(repo_id);
CREATE INDEX IF NOT EXISTS idx_module_refs_repo ON module_references(repo_id);
CREATE INDEX IF NOT EXISTS idx_stack_deps_repo ON stack_dependencies(repo_id);
CREATE INDEX IF NOT EXISTS idx_config_values_repo ON config_values(repo_id);
CREATE INDEX IF NOT EXISTS idx_upstream_lineage_consumer ON upstream_lineage(consumer_repo_id);
CREATE INDEX IF NOT EXISTS idx_upstream_lineage_upstream ON upstream_lineage(upstream_repo_id);

CREATE TABLE IF NOT EXISTS parsed_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  block_type TEXT NOT NULL,
  labels JSONB DEFAULT '[]',
  file TEXT,
  line INTEGER,
  attributes JSONB DEFAULT '{}',
  nested_blocks JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT,
  line INTEGER,
  attributes JSONB DEFAULT '{}',
  nested_blocks JSONB DEFAULT '{}',
  references_json JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variables (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  name TEXT NOT NULL,
  var_type TEXT,
  default_json JSONB,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  file TEXT,
  line INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outputs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  name TEXT NOT NULL,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  file TEXT,
  line INTEGER,
  value_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  provider_type TEXT NOT NULL,
  alias TEXT,
  attributes JSONB DEFAULT '{}',
  file TEXT,
  line INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remote_state_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  scan_run_id UUID REFERENCES scan_runs(id),
  name TEXT NOT NULL,
  backend TEXT,
  state_key TEXT,
  target_repo_hint TEXT,
  config JSONB DEFAULT '{}',
  file TEXT,
  line INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parsed_blocks_repo ON parsed_blocks(repo_id);
CREATE INDEX IF NOT EXISTS idx_parsed_blocks_type ON parsed_blocks(repo_id, block_type);
CREATE INDEX IF NOT EXISTS idx_data_sources_repo ON data_sources(repo_id);
CREATE INDEX IF NOT EXISTS idx_variables_repo ON variables(repo_id);
CREATE INDEX IF NOT EXISTS idx_outputs_repo ON outputs(repo_id);
CREATE INDEX IF NOT EXISTS idx_provider_configs_repo ON provider_configs(repo_id);
CREATE INDEX IF NOT EXISTS idx_remote_state_refs_repo ON remote_state_refs(repo_id);

-- Versioned Terraform module interface contracts for release comparison.
-- Prefer these when multi-version checkout history is unavailable.
CREATE TABLE IF NOT EXISTS module_release_contracts (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  module_source TEXT,
  version TEXT NOT NULL,
  display_name TEXT,
  variables JSONB NOT NULL DEFAULT '[]',
  outputs JSONB NOT NULL DEFAULT '[]',
  source_kind TEXT NOT NULL DEFAULT 'seed',
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (module_id, version)
);

CREATE INDEX IF NOT EXISTS idx_module_release_contracts_module
  ON module_release_contracts(module_id);

-- Scaffolded PR raise requests (GitHub integration may be incomplete).
-- Status flow: pending_analysis → awaiting_approval → approved|rejected →
--   then scaffold/github path (awaiting_github_credentials | queued | …).
CREATE TABLE IF NOT EXISTS pr_draft_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  module_id TEXT,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'scaffold',
  pr_url TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  analysis JSONB NOT NULL DEFAULT '{}',
  approval_state TEXT NOT NULL DEFAULT 'none',
  approver TEXT,
  approval_comment TEXT,
  approved_at TIMESTAMPTZ,
  job_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Local upgrades when table already existed without analysis/approval columns.
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS analysis JSONB NOT NULL DEFAULT '{}';
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS approval_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS approver TEXT;
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS approval_comment TEXT;
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS chat_messages JSONB NOT NULL DEFAULT '[]';

-- Layer 2 APPSVN columns for existing volumes (idempotent).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS appsvn TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS application_label TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS appsvn TEXT;
CREATE INDEX IF NOT EXISTS idx_subscriptions_appsvn ON subscriptions(appsvn);
CREATE INDEX IF NOT EXISTS idx_resources_appsvn ON resources(appsvn);

-- IGCS: SHA watermark + clone metadata for world-class incremental scanning.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_scanned_sha TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_scanned_ref TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS clone_url TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_incremental_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_full_scan_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS scan_stats JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_subscriptions_last_scanned_sha ON subscriptions(last_scanned_sha);

-- Webhook delivery dedupe (GitHub X-GitHub-Delivery).
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'github',
  event_type TEXT,
  repo_id TEXT,
  accepted BOOLEAN NOT NULL DEFAULT true,
  payload_summary JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received ON webhook_deliveries(received_at DESC);

-- Push coalesce / scan lag metrics (lightweight).
CREATE TABLE IF NOT EXISTS scan_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  mode TEXT,
  from_sha TEXT,
  to_sha TEXT,
  files_touched INTEGER DEFAULT 0,
  parse_ms INTEGER DEFAULT 0,
  graph_ms INTEGER DEFAULT 0,
  coalesce_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_metrics_repo ON scan_metrics(repo_id, created_at DESC);

ALTER TABLE change_plans ADD COLUMN IF NOT EXISTS impact_report JSONB NOT NULL DEFAULT '{}';
ALTER TABLE rollout_plans ADD COLUMN IF NOT EXISTS locations JSONB NOT NULL DEFAULT '[]';
ALTER TABLE rollout_plans ADD COLUMN IF NOT EXISTS downstream_repo_id TEXT;

CREATE INDEX IF NOT EXISTS idx_change_plans_updated ON change_plans(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_draft_requests_repo ON pr_draft_requests(repo_id);
CREATE INDEX IF NOT EXISTS idx_pr_draft_requests_status ON pr_draft_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_draft_requests_approval ON pr_draft_requests(approval_state);

-- Layer 1 intelligent pattern catalog (architect / auditor stamping).
-- pattern_id is the stable audit control id (e.g. PAT-RDS-PGSQL-MULTIAZ-HA).
CREATE TABLE IF NOT EXISTS infra_patterns (
  pattern_id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('simple', 'complex')),
  audit_statement TEXT NOT NULL,
  finops_notes TEXT,
  architect_summary TEXT,
  detection_rules JSONB NOT NULL DEFAULT '{}',
  seeded BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_infra_patterns_family ON infra_patterns(family);
CREATE INDEX IF NOT EXISTS idx_infra_patterns_tier ON infra_patterns(tier);

-- Auditor / compliance stamps on a Layer-1 pattern.
-- Active stamp (revoked_at IS NULL) implies inherited coverage for all
-- APPSVN/apps implemented on that pattern.
CREATE TABLE IF NOT EXISTS pattern_stamps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id TEXT NOT NULL REFERENCES infra_patterns(pattern_id) ON DELETE CASCADE,
  auditor TEXT NOT NULL,
  comment TEXT,
  compliance_framework TEXT,
  stamped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pattern_stamps_pattern ON pattern_stamps(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_stamps_active
  ON pattern_stamps(pattern_id) WHERE revoked_at IS NULL;

-- Seeded taxonomy (idempotent upserts for fresh volumes).
INSERT INTO infra_patterns (
  pattern_id, family, display_name, tier, audit_statement, finops_notes, architect_summary, detection_rules
) VALUES
  (
    'PAT-RDS-PGSQL-SINGLE-AZ-STD',
    'RDS-PGSQL',
    'PostgreSQL RDS single-AZ standard (no HA)',
    'simple',
    'Control: PostgreSQL RDS deployed single-AZ without Multi-AZ standby or DR replica topology.',
    'Lowest RDS HA cost posture; no standby instance charge. Accept residual AZ-failure risk.',
    'Single writer, one AZ. No Multi-AZ, no cross-region/DR replica.',
    '{"resource_types":["aws_db_instance"],"engines":["postgres","postgresql"],"complex_signals":[]}'::jsonb
  ),
  (
    'PAT-RDS-PGSQL-MULTIAZ-HA',
    'RDS-PGSQL',
    'PostgreSQL RDS Multi-AZ HA',
    'complex',
    'Control: PostgreSQL RDS with Multi-AZ synchronous standby and/or DR/read-replica HA extras.',
    'HA premium: Multi-AZ standby roughly doubles instance cost; DR replicas add additional capacity.',
    'Multi-AZ and/or replica/DR topology for PostgreSQL RDS.',
    '{"resource_types":["aws_db_instance"],"engines":["postgres","postgresql"],"complex_signals":["multi_az","replica","dr"]}'::jsonb
  ),
  (
    'PAT-RDS-MSSQL-SINGLE-AZ-STD',
    'RDS-MSSQL',
    'SQL Server RDS single-AZ standard (no HA)',
    'simple',
    'Control: SQL Server RDS single-AZ without Multi-AZ or custom DR.',
    'Standard SQL Server license + single instance; no HA standby spend.',
    'Single-AZ SQL Server RDS writer only.',
    '{"resource_types":["aws_db_instance"],"engines":["sqlserver"],"complex_signals":[]}'::jsonb
  ),
  (
    'PAT-RDS-MSSQL-MULTIAZ-HA',
    'RDS-MSSQL',
    'SQL Server RDS Multi-AZ HA',
    'complex',
    'Control: SQL Server RDS Multi-AZ and/or DR/replica HA posture.',
    'Multi-AZ + SQL Server licensing compounds HA cost; justify for criticality tier.',
    'Multi-AZ / replica SQL Server RDS topology.',
    '{"resource_types":["aws_db_instance"],"engines":["sqlserver"],"complex_signals":["multi_az","replica","dr"]}'::jsonb
  ),
  (
    'PAT-RDS-APGSQL-SINGLE-WRITER',
    'RDS-APGSQL',
    'Aurora PostgreSQL single-writer (no HA cluster extras)',
    'simple',
    'Control: Aurora PostgreSQL cluster with single writer and no Multi-AZ reader/DR extras.',
    'Minimal Aurora cluster cost; no reader nodes or cross-AZ HA premium.',
    'Aurora PG single writer; no additional readers / Multi-AZ HA extras detected.',
    '{"resource_types":["aws_rds_cluster","aws_db_instance"],"engines":["aurora-postgresql"],"complex_signals":[]}'::jsonb
  ),
  (
    'PAT-RDS-APGSQL-HA-CLUSTER',
    'RDS-APGSQL',
    'Aurora PostgreSQL Multi-AZ HA cluster',
    'complex',
    'Control: Aurora PostgreSQL with Multi-AZ and/or reader replicas / custom HA.',
    'Reader nodes and Multi-AZ storage/compute increase Aurora spend; maps to HA SLA tier.',
    'Aurora PG with Multi-AZ and/or reader/DR topology.',
    '{"resource_types":["aws_rds_cluster","aws_rds_cluster_instance","aws_db_instance"],"engines":["aurora-postgresql"],"complex_signals":["multi_az","replica","reader","dr"]}'::jsonb
  ),
  (
    'PAT-EC2-ORACLE-SINGLE',
    'Ec2Oracle',
    'EC2 Oracle single-instance (no DR pair)',
    'simple',
    'Control: Oracle on EC2 as a single instance without a DR/standby pair.',
    'Single EC2 + attached storage; no idle DR compute cost.',
    'One Oracle EC2 instance; no DR/standby counterpart detected.',
    '{"resource_types":["aws_instance"],"oracle_signals":["ami","tags"],"complex_signals":[]}'::jsonb
  ),
  (
    'PAT-EC2-ORACLE-DR-PAIR',
    'Ec2Oracle',
    'EC2 Oracle DR pair (primary + standby)',
    'complex',
    'Control: Oracle on EC2 with primary/standby DR pair or multi-AZ HA extras.',
    'DR standby roughly doubles compute/storage; tag Role=dr-standby for FinOps attribution.',
    'Primary + DR/standby Oracle EC2 topology across AZ or role tags.',
    '{"resource_types":["aws_instance"],"oracle_signals":["ami","tags"],"complex_signals":["dr","standby","multi_az"]}'::jsonb
  )
ON CONFLICT (pattern_id) DO UPDATE SET
  family = EXCLUDED.family,
  display_name = EXCLUDED.display_name,
  tier = EXCLUDED.tier,
  audit_statement = EXCLUDED.audit_statement,
  finops_notes = EXCLUDED.finops_notes,
  architect_summary = EXCLUDED.architect_summary,
  detection_rules = EXCLUDED.detection_rules,
  updated_at = now();
