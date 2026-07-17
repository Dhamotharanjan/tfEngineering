import { useSearchParams, Link } from 'react-router-dom';
import Header from '../components/Header';
import { PageShell } from '../components/ui';

const plans = {
  build: {
    title: 'RDS Build Plan',
    steps: [
      'Validate KMS key exists (registry: kms) — kms/payments-staging',
      'Confirm DB subnet group in isolated PCI staging VPC',
      'Security group: no 0.0.0.0/0 ingress',
      'Engine: oracle-ee 19c — apply recommended patch baseline',
      'Enable storage_encrypted = true',
      'FinOps estimate: db.r5.xlarge ~$2,840/mo',
    ],
    storage: 'PostgreSQL lifecycle_requests + Neo4j planned nodes',
  },
  rebuild: {
    title: 'RDS Rebuild Plan',
    steps: [
      'Blast radius: 3 downstream Terragrunt stacks reference this endpoint',
      'Strategy: maintenance_window (prod PCI)',
      'Notify: @payments-platform, security-arch@acme.com',
      'Pre-check: create snapshot before rebuild',
      'Validate outputs: endpoint, port, db_name unchanged for consumers',
    ],
    storage: 'PostgreSQL change_plans + graph downstream refs',
  },
  restore: {
    title: 'RDS Restore + DR Test Plan',
    steps: [
      'Snapshot: prod-payments-2026-07-01 (encrypted, KMS kms/payments-prod)',
      'Target: isolated staging subnet (no prod routing)',
      'DR test workflow started — CloudWatch alarms enabled',
      'Security patch delta: 5 patches since snapshot date',
      'Auto-schedule decommission: 2026-07-20 10:00 UTC (72h)',
    ],
    storage: 'PostgreSQL dr_tests + platform_observability registry',
  },
  decommission: {
    title: 'RDS Decommission Plan',
    steps: [
      '✓ Blast radius check passed — no subscribed downstream refs',
      '1. Revoke IAM database authentication',
      '2. Remove Secrets Manager references',
      '3. Update Terragrunt inputs in consumer repos (if any)',
      '4. Optional final snapshot (policy: retain 7 days)',
      '5. terraform destroy — test instance only',
      '6. KMS key review — retain 90 days per registry',
      'FinOps savings: ~$420/mo',
    ],
    storage: 'PostgreSQL lifecycle_requests + audit_log export',
  },
};

export default function LifecycleWizard() {
  const [params] = useSearchParams();
  const action = params.get('action') || 'build';
  const plan = plans[action] || plans.build;

  return (
    <PageShell
      header={
        <Header
          title="Lifecycle Wizard"
          subtitle={plan.title}
          actions={<Link to="/lifecycle/rds" className="btn-secondary">← Back to RDS Hub</Link>}
        />
      }
    >
      <div className="mb-4 badge-info">Data store: {plan.storage}</div>
      <div className="card">
        <div className="card-body">
          <ol className="space-y-4">
            {plan.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-300">
                <span className="font-mono text-brand-400">{String(i + 1).padStart(2, '0')}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex gap-3">
            <button type="button" className="btn-primary">Approve & export plan</button>
            <button type="button" className="btn-secondary">Post to GitHub issue</button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
