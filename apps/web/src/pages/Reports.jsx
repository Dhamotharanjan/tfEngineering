import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { changePlan } from '../data/mockData';

export default function Reports() {
  return (
    <PageShell
      header={
        <Header
          title="CAB Reports & Export"
          subtitle="PDF/CSV impact packs for change advisory boards — stored in MinIO"
          actions={<button type="button" className="btn-primary">Download PDF</button>}
        />
      }
    >
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold">Report preview: {changePlan.title}</h3>
        </div>
        <div className="card-body font-mono text-xs text-slate-300 whitespace-pre-wrap">
{`INFRASTRUCTURE CHANGE ADVISORY PACK
Generated: 2026-07-17T10:45:00Z
Organization: Acme Bank

SUMMARY
- Module: modules/vpc v2.4.2 → v3.0.0
- Blast radius: 23 stacks, 4 accounts, 6 teams
- PCI stacks affected: 3
- Estimated monthly spend in scope: $42,800

PHASED ROLLOUT
Phase 1 (Dev): 8 stacks — platform-dev, data-dev
Phase 2 (Staging): 7 stacks — payments, checkout
Phase 3 (Prod): 8 stacks — CAB + Security required

ROLLBACK
Revert to tag v2.4.2 across all consumers. RTO < 15 minutes.

EVIDENCE
- Graph traversal: Neo4j path mod-vpc → payments-vpc-prod → PCI CDE
- Source: acme/infra-payments-prod/terragrunt.hcl:42

Approvals: _______________  Date: _______________`}
        </div>
      </div>
    </PageShell>
  );
}
