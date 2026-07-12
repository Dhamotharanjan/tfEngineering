import json
import re
from pathlib import Path
from typing import List, Dict

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_REPO_ROOT = ROOT / 'sample_repos'

SOURCE_PATTERNS = [
    re.compile(r'source\s*=\s*"\.\./([^"/]+)"'),
    re.compile(r'dependency\s+"([^"/]+)"'),
    re.compile(r'\-\s*\.\./([^\s]+)'),
]

RESOURCE_PATTERN = re.compile(r'resource\s+"([^"]+)"\s+"([^"]+)"', re.MULTILINE)
DATA_PATTERN = re.compile(r'data\s+"([^"]+)"\s+"([^"]+)"', re.MULTILINE)
VARIABLE_PATTERN = re.compile(r'variable\s+"([^"]+)"', re.MULTILINE)
OUTPUT_PATTERN = re.compile(r'output\s+"([^"]+)"', re.MULTILINE)
MODULE_PATTERN = re.compile(r'module\s+"([^"]+)"\s*\{(.*?)\}', re.MULTILINE | re.DOTALL)
PROVIDER_PATTERN = re.compile(r'provider\s+"([^"]+)"', re.MULTILINE)
TERRAFORM_BLOCK_PATTERN = re.compile(r'terraform\s*\{(.*?)\}', re.MULTILINE | re.DOTALL)
BACKEND_PATTERN = re.compile(r'backend\s+"([^"]+)"', re.MULTILINE)
REQUIRED_PROVIDER_PATTERN = re.compile(r'([a-zA-Z0-9_-]+)\s*=\s*\{', re.MULTILINE)
LOCALS_BLOCK_PATTERN = re.compile(r'locals\s*\{(.*?)\}', re.MULTILINE | re.DOTALL)
LOCAL_ASSIGN_PATTERN = re.compile(r'^\s*([a-zA-Z0-9_]+)\s*=', re.MULTILINE)
TG_DEPENDENCIES_PATHS_PATTERN = re.compile(r'dependencies\s*\{[^}]*paths\s*=\s*\[(.*?)\]', re.MULTILINE | re.DOTALL)
TG_INPUTS_PATTERN = re.compile(r'inputs\s*=\s*\{(.*?)\}', re.MULTILINE | re.DOTALL)
TG_REMOTE_STATE_PATTERN = re.compile(r'remote_state\s*\{(.*?)\}', re.MULTILINE | re.DOTALL)
TG_INCLUDE_PATTERN = re.compile(r'include\s+"([^"]+)"', re.MULTILINE)


def extract_hcl_metadata(text: str) -> Dict[str, object]:
    resources = [{'type': res_type, 'name': res_name} for res_type, res_name in RESOURCE_PATTERN.findall(text)]
    data_sources = [{'type': data_type, 'name': data_name} for data_type, data_name in DATA_PATTERN.findall(text)]
    variables = VARIABLE_PATTERN.findall(text)
    outputs = OUTPUT_PATTERN.findall(text)
    providers = PROVIDER_PATTERN.findall(text)

    modules = []
    module_sources = []
    for module_name, body in MODULE_PATTERN.findall(text):
        source_match = re.search(r'source\s*=\s*"([^"]+)"', body)
        module_source = source_match.group(1) if source_match else ''
        modules.append({'name': module_name, 'source': module_source})
        if module_source:
            module_sources.append(module_source)

    backend_types = []
    required_providers = []
    terraform_block_match = TERRAFORM_BLOCK_PATTERN.search(text)
    if terraform_block_match:
        terraform_body = terraform_block_match.group(1)
        backend_types = BACKEND_PATTERN.findall(terraform_body)
        if 'required_providers' in terraform_body:
            required_providers = list({name for name in REQUIRED_PROVIDER_PATTERN.findall(terraform_body) if name != 'source' and name != 'version'})

    local_symbols = []
    for locals_body in LOCALS_BLOCK_PATTERN.findall(text):
        local_symbols.extend(LOCAL_ASSIGN_PATTERN.findall(locals_body))

    tg_dependencies = []
    for paths_blob in TG_DEPENDENCIES_PATHS_PATTERN.findall(text):
        for path in re.findall(r'"([^"]+)"', paths_blob):
            tg_dependencies.append(path)

    tg_dependency_blocks = re.findall(r'dependency\s+"([^"]+)"', text)
    tg_inputs = LOCAL_ASSIGN_PATTERN.findall('{' + ''.join(TG_INPUTS_PATTERN.findall(text)) + '}')
    tg_remote_state_backends = BACKEND_PATTERN.findall(''.join(TG_REMOTE_STATE_PATTERN.findall(text)))
    tg_includes = TG_INCLUDE_PATTERN.findall(text)

    return {
        'resources': resources,
        'data_sources': data_sources,
        'variables': variables,
        'outputs': outputs,
        'providers': providers,
        'modules': modules,
        'module_sources': module_sources,
        'backend_types': backend_types,
        'required_providers': required_providers,
        'locals': local_symbols,
        'terragrunt_dependencies': tg_dependencies,
        'terragrunt_dependency_blocks': tg_dependency_blocks,
        'terragrunt_inputs': tg_inputs,
        'terragrunt_remote_state_backends': tg_remote_state_backends,
        'terragrunt_includes': tg_includes,
    }


def find_local_repo_name(path: str) -> str:
    return Path(path).name


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


def build_repo_details(repos, edges, repo_files, repo_metadata):
    parents = {repo: [] for repo in repos}
    dependents = {repo: [] for repo in repos}
    for e in edges:
        parents[e['to']].append(e['from'])
        dependents[e['from']].append(e['to'])

    cycles = build_cycle_map(repos, edges)
    cycle_nodes = {node for cycle in cycles for node in cycle}

    details = {}
    for repo in repos:
        parsed = repo_metadata.get(repo, {})
        owner_team = 'core-engineering' if not parents.get(repo) else 'engineering-team'
        repo_tier = 'upstream' if owner_team == 'core-engineering' else 'downstream'
        summary = {
            'resource_count': len(parsed.get('resources', [])),
            'module_count': len(parsed.get('modules', [])),
            'variable_count': len(parsed.get('variables', [])),
            'output_count': len(parsed.get('outputs', [])),
            'provider_count': len(parsed.get('providers', [])),
            'data_source_count': len(parsed.get('data_sources', [])),
            'locals_count': len(parsed.get('locals', [])),
        }
        details[repo] = {
            'parents': parents.get(repo, []),
            'dependents': dependents.get(repo, []),
            'files': repo_files.get(repo, []),
            'description': f'{repo} ({repo_tier}, owner: {owner_team}) includes Terraform/Terragrunt configuration and depends on upstream repo parameters.',
            'cycle': repo in cycle_nodes,
            'cycle_paths': [cycle for cycle in cycles if repo in cycle],
            'owner_team': owner_team,
            'repo_tier': repo_tier,
            'parsed_fields': parsed,
            'summary': summary,
        }
    return details, cycles


def parse_repo_files(repo_path: Path) -> Dict[str, List[str]]:
    deps = []
    files = []
    aggregated = {
        'resources': [],
        'data_sources': [],
        'variables': [],
        'outputs': [],
        'providers': [],
        'modules': [],
        'module_sources': [],
        'backend_types': [],
        'required_providers': [],
        'locals': [],
        'terragrunt_dependencies': [],
        'terragrunt_dependency_blocks': [],
        'terragrunt_inputs': [],
        'terragrunt_remote_state_backends': [],
        'terragrunt_includes': [],
    }
    for path in repo_path.rglob('*'):
        if path.is_file():
            files.append(path.relative_to(repo_path).as_posix())
            if path.suffix in {'.tf', '.hcl', '.yaml', '.yml'}:
                text = path.read_text(encoding='utf-8', errors='ignore')
                for pat in SOURCE_PATTERNS:
                    for match in pat.findall(text):
                        if isinstance(match, tuple):
                            match = match[0]
                        deps.append(match)
                parsed = extract_hcl_metadata(text)
                for key, value in parsed.items():
                    if isinstance(value, list):
                        aggregated[key].extend(value)

    # Dedupe scalar lists and simple dict lists while preserving order.
    for key, value in aggregated.items():
        if not value:
            continue
        if value and isinstance(value[0], dict):
            seen = set()
            deduped = []
            for item in value:
                item_key = json.dumps(item, sort_keys=True)
                if item_key not in seen:
                    seen.add(item_key)
                    deduped.append(item)
            aggregated[key] = deduped
        else:
            aggregated[key] = list(dict.fromkeys(value))

    return {
        'dependencies': sorted(set(deps)),
        'files': sorted(set(files)),
        'parsed_fields': aggregated,
    }


def resolve_repo_paths(inputs: List[str]) -> List[Path]:
    repos = []
    for item in inputs:
        item = item.strip()
        if not item:
            continue
        p = Path(item)
        if p.is_dir():
            repos.append(p.resolve())
        else:
            sample_candidate = SAMPLE_REPO_ROOT / p.name
            if sample_candidate.is_dir():
                repos.append(sample_candidate.resolve())
                continue
            candidate = ROOT / item
            if candidate.is_dir():
                repos.append(candidate.resolve())
    return repos


def parse_repos(repo_inputs: List[str]) -> Dict[str, object]:
    repo_paths = resolve_repo_paths(repo_inputs)
    nodes = []
    edges = []
    known = {}
    seen_edges = set()
    repo_files = {}
    repo_metadata = {}

    for repo_path in repo_paths:
        name = find_local_repo_name(str(repo_path))
        known[name] = repo_path
        nodes.append({'id': name, 'label': name, 'change_pending': True})

    for repo_name, repo_path in known.items():
        info = parse_repo_files(repo_path)
        repo_files[repo_name] = [f'{repo_name}/{rel_path}' for rel_path in info.get('files', [])]
        repo_metadata[repo_name] = info.get('parsed_fields', {})
        for dep in info['dependencies']:
            dep_name = find_local_repo_name(dep)
            if dep_name in known and dep_name != repo_name:
                edge_key = (repo_name, dep_name)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append({'from': repo_name, 'to': dep_name})

    for edge in edges:
        edge['match_pct'] = compute_parameter_score(edge['from'], edge['to'])
        edge['upstream_file'] = f'{edge["from"]}/main.tf'
        edge['downstream_file'] = f'{edge["to"]}/module.tf'

    repo_details, cycles = build_repo_details(list(known.keys()), edges, repo_files, repo_metadata)
    return {'nodes': nodes, 'edges': edges, 'repo_details': repo_details, 'cycles': cycles}
