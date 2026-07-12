import random
from typing import List, Dict

SECURITY_FINDINGS = [
    {'id': 'S001', 'title': 'S3 bucket public exposure', 'severity': 9.2, 'suggestion': 'Ensure bucket ACL is private and use IAM policies.'},
    {'id': 'S002', 'title': 'Hardcoded credentials', 'severity': 8.7, 'suggestion': 'Move secrets into Vault or environment variables.'},
    {'id': 'S003', 'title': 'Outdated provider pin', 'severity': 7.3, 'suggestion': 'Upgrade provider version to address CVE risk.'},
    {'id': 'S004', 'title': 'Unused module dependency', 'severity': 5.8, 'suggestion': 'Remove orphaned module references to reduce maintenance burden.'},
]


def score_repo_impact(repo: str, nodes: List[Dict]) -> Dict:
    # Simulated AI analysis: severity increases with downstream impact
    downstream_count = sum(1 for node in nodes if node['id'] != repo)
    base = random.uniform(3.0, 5.0)
    impact = min(10.0, base + downstream_count * 0.8)
    return {
        'repo': repo,
        'impact_score': round(impact, 1),
        'finding': random.choice(SECURITY_FINDINGS),
        'priority': 'High' if impact >= 8 else 'Medium' if impact >= 5 else 'Low',
    }


def rank_repos(repos: List[Dict]) -> List[Dict]:
    ranked = [score_repo_impact(repo['id'], repos) for repo in repos]
    return sorted(ranked, key=lambda x: x['impact_score'], reverse=True)
