import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'sample_data.json'

# simple parser for a comma-separated repo list
# returns node entries and direct dependency edges by naming convention

def compute_parameter_score(upstream: str, downstream: str) -> int:
    shared = set(upstream.split('-')) & set(downstream.split('-'))
    score = 50 + len(shared) * 10
    score += min(20, max(0, len(downstream) - len(upstream)))
    return min(100, max(30, score))


def build_cycle_map(repos, edges):
    graph = {repo: [] for repo in repos}
    for e in edges:
        graph[e['from']].append(e['to'])

    cycles = []
    visited = set()

    def dfs(node, path):
        if node in path:
            cycle = path[path.index(node):] + [node]
            cycles.append(cycle)
            return
        if node in visited:
            return
        path.append(node)
        for child in graph.get(node, []):
            dfs(child, path)
        path.pop()
        visited.add(node)

    for repo in repos:
        dfs(repo, [])
    return cycles


def build_repo_details(repos, edges):
    parents = {repo: [] for repo in repos}
    dependents = {repo: [] for repo in repos}
    for e in edges:
        parents[e['to']].append(e['from'])
        dependents[e['from']].append(e['to'])

    cycles = build_cycle_map(repos, edges)
    cycle_nodes = {node for cycle in cycles for node in cycle}

    details = {}
    for repo in repos:
        details[repo] = {
            'parents': parents.get(repo, []),
            'dependents': dependents.get(repo, []),
            'files': [f'{repo}/main.tf', f'{repo}/variables.tf', f'{repo}/modules/{repo}_module.tf'],
            'description': f'{repo} includes Terraform/Terragrunt configuration and depends on upstream repo parameters.',
            'cycle': repo in cycle_nodes,
            'cycle_paths': [cycle for cycle in cycles if repo in cycle],
        }
    return details, cycles


def parse_repo_list(content):
    repos = [line.strip() for line in content.splitlines() if line.strip()]
    nodes = [{'id': r, 'label': r, 'change_pending': True} for r in repos]
    edges = []
    # build fake dependency structure:
    # repo-a -> repo-b, repo-c; repo-b -> repo-d; repo-c -> repo-d; repo-d -> repo-e
    if 'repo-a' in repos and 'repo-b' in repos:
        edges.append({'from': 'repo-a', 'to': 'repo-b'})
    if 'repo-a' in repos and 'repo-c' in repos:
        edges.append({'from': 'repo-a', 'to': 'repo-c'})
    if 'repo-b' in repos and 'repo-d' in repos:
        edges.append({'from': 'repo-b', 'to': 'repo-d'})
    if 'repo-c' in repos and 'repo-d' in repos:
        edges.append({'from': 'repo-c', 'to': 'repo-d'})
    if 'repo-d' in repos and 'repo-e' in repos:
        edges.append({'from': 'repo-d', 'to': 'repo-e'})

    for edge in edges:
        edge['match_pct'] = compute_parameter_score(edge['from'], edge['to'])
        edge['upstream_file'] = f'{edge["from"]}/main.tf'
        edge['downstream_file'] = f'{edge["to"]}/module.tf'

    repo_details, cycles = build_repo_details(repos, edges)
    return {'nodes': nodes, 'edges': edges, 'repo_details': repo_details, 'cycles': cycles}


def save_graph(graph):
    DATA_PATH.write_text(json.dumps(graph, indent=2), encoding='utf-8')


def load_graph():
    return json.loads(DATA_PATH.read_text(encoding='utf-8'))
