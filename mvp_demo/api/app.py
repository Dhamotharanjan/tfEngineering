import json
import os
import difflib
import re
import time
import threading
import queue
import traceback
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, Response

from api.parse_upload import parse_repo_list, save_graph
from api.repo_import import parse_repos
from api.ai_ranking import rank_repos
from api.iac_validation import validate_repo_iac
from api.platform_sync import (
    clear_all_platforms,
    descendants_from_neo4j,
    load_graph_from_neo4j,
    milvus_repo_neighbors,
    neo4j_dependency_insights,
    neo4j_repo_risk,
    neo4j_sync_configured,
    postgres_repo_context,
    sync_milvus,
    sync_neo4j,
    sync_postgres,
)

DATA_PATH = Path(__file__).resolve().parents[1] / 'sample_data.json'
SAMPLE_REPO_ROOT = Path(__file__).resolve().parents[1] / 'sample_repos'
TOTAL_UPLOAD_STEPS = 7

DIFF_FILE_ORDER = [
    'terragrunt.hcl',
    'main.tf',
    'deploy.yaml',
    'dependencies.yaml',
    'kustomization.yaml',
    'variables.tf',
]


def empty_graph_state():
    return {
        'nodes': [],
        'edges': [],
        'diffs': {},
        'metadata': {
            'description': 'Engineering knowledge graph has been cleared.'
        },
        'repo_details': {},
        'cycles': [],
    }


def persist_graph_state(state):
    graph.clear()
    graph.update(state)
    node_map.clear()
    node_map.update({n['id']: n for n in graph['nodes']})
    adj.clear()
    adj.update(build_adjacency(graph['edges']))
    save_graph(graph)


def get_platform_links():
    return {
        'neo4j_url': os.environ.get('NEO4J_URL', 'http://localhost:7474'),
        'milvus_url': os.environ.get('MILVUS_URL', 'http://localhost:9091'),
        'milvus_ui_note': os.environ.get('MILVUS_UI_NOTE', 'Milvus on port 9091 is typically an API endpoint, not a built-in browser UI.'),
        'postgres_url': os.environ.get('POSTGRES_URL', 'postgresql://localhost:5432/tfengineering'),
    }


def build_postgres_tables(total_nodes, total_edges, cycle_count, step):
    file_inventory_rows = total_nodes * 3
    tables = [
        {
            'name': 'repo_catalog',
            'rows': total_nodes,
            'status': 'completed' if step >= 1 else 'pending',
        },
        {
            'name': 'dependency_edges',
            'rows': total_edges,
            'status': 'completed' if step >= 2 else 'pending',
        },
        {
            'name': 'repo_file_inventory',
            'rows': file_inventory_rows,
            'status': 'completed' if step >= 3 else 'pending',
        },
        {
            'name': 'cycle_registry',
            'rows': cycle_count,
            'status': 'completed' if step >= 4 else 'pending',
        },
        {
            'name': 'scan_audit_log',
            'rows': total_nodes,
            'status': 'completed' if step >= TOTAL_UPLOAD_STEPS else 'processing',
        },
    ]
    return tables


def build_vector_db_details(total_nodes, total_edges, step):
    return {
        'collection_name': 'engineering_repo_vectors',
        'status': 'completed' if step >= TOTAL_UPLOAD_STEPS else 'indexing',
        'entity_count': total_nodes,
        'vector_dimension': int(os.environ.get('MILVUS_VECTOR_DIMENSION', '8')),
        'index_type': 'HNSW',
        'metric_type': 'COSINE',
        'partitions': max(1, total_edges // 4) if total_nodes else 0,
        'sync_stage': f'Step {step} of {TOTAL_UPLOAD_STEPS}',
    }


def candidate_repo_files(repo_id):
    repo_root = SAMPLE_REPO_ROOT / repo_id
    if not repo_root.exists():
        return []
    ordered = []
    for file_name in DIFF_FILE_ORDER:
        path = repo_root / file_name
        if path.exists():
            ordered.append(path)
    for path in sorted(repo_root.rglob('*')):
        if path.is_file() and path not in ordered:
            ordered.append(path)
    return ordered


def apply_simulated_change(repo_id, file_path, content):
    updated = content
    file_name = file_path.name
    if 'app-bucket-old' in updated:
        updated = updated.replace('app-bucket-old', f'{repo_id}-bucket-secure')
    if 'ref=v1.0.0' in updated:
        updated = updated.replace('ref=v1.0.0', 'ref=v1.1.0')
    if 'db.t3.small' in updated:
        updated = updated.replace('db.t3.small', 'db.t3.micro')
    if 'db.m5.2xlarge' in updated:
        updated = updated.replace('db.m5.2xlarge', 'db.t3.medium')
    if 'm5.4xlarge' in updated:
        updated = updated.replace('m5.4xlarge', 'm5.large')
    if '0.0.0.0/0' in updated:
        updated = updated.replace('0.0.0.0/0', '10.42.0.0/16')
    if 'nodejs18.x' in updated:
        updated = updated.replace('nodejs18.x', 'nodejs20.x')
    if updated == content and file_name == 'main.tf':
        updated = f'# simulated change for {repo_id}\n{content}'
    elif updated == content and file_name.endswith('.yaml'):
        updated = f'# simulated rollout update for {repo_id}\n{content}'
    elif updated == content and file_name == 'variables.tf':
        revision_name = repo_id.replace('-', '_')
        updated = content + f'\nvariable "{revision_name}_revision" {{\n  type = string\n  default = "v2"\n}}\n'
    return updated


def create_unified_diff(repo_id, file_path, original, updated, label):
    relative_path = f'{repo_id}/{file_path.name}'
    lines = list(difflib.unified_diff(
        original.splitlines(),
        updated.splitlines(),
        fromfile=f'a/{relative_path}',
        tofile=f'b/{relative_path}',
        lineterm='',
    ))
    return {
        'path': relative_path,
        'label': label,
        'diff': '\n'.join(lines),
    }


def build_repo_diffs(repo_details):
    repo_diffs = {}
    for repo_id, detail in repo_details.items():
        patches = []
        for file_path in candidate_repo_files(repo_id):
            original = file_path.read_text(encoding='utf-8', errors='ignore')
            updated = apply_simulated_change(repo_id, file_path, original)
            if updated != original:
                label = 'Primary change' if file_path.name in {'main.tf', 'terragrunt.hcl'} else 'Required fix'
                patches.append(create_unified_diff(repo_id, file_path, original, updated, label))
        repo_diffs[repo_id] = {
            'file_tree': detail.get('files', []),
            'patches': patches,
        }
    return repo_diffs


def build_platform_sync_state(results):
    return {
        'neo4j': results.get('neo4j', {'status': 'pending'}),
        'postgres': results.get('postgres', {'status': 'pending'}),
        'milvus': results.get('milvus', {'status': 'pending'}),
    }


def run_platform_sync(sync_name, sync_fn, sync_graph):
    try:
        return sync_fn(sync_graph)
    except Exception as exc:
        error_text = str(exc)
        if error_text.endswith('is not configured'):
            return {'status': 'not_configured', 'error': error_text, 'platform': sync_name}
        return {'status': 'failed', 'error': error_text, 'platform': sync_name}

app = Flask(__name__, static_folder='../web', static_url_path='')

# Load data into memory
with open(DATA_PATH, 'r', encoding='utf-8') as f:
    graph = json.load(f)

# Helper: build adjacency map
def build_adjacency(edges):
    adj = {}
    for e in edges:
        adj.setdefault(e['from'], []).append(e['to'])
    return adj

adj = build_adjacency(graph['edges'])
node_map = {n['id']: n for n in graph['nodes']}

def descendants(start_id):
    seen = set()
    stack = [start_id]
    while stack:
        cur = stack.pop()
        for nb in adj.get(cur, []):
            if nb not in seen:
                seen.add(nb)
                stack.append(nb)
    return list(seen)


def get_live_graph_state():
    if not neo4j_sync_configured():
        return graph
    try:
        return load_graph_from_neo4j(graph)
    except Exception:
        return graph


def descendants_from_graph(graph_state, start_id):
    live_adj = build_adjacency(graph_state.get('edges', []))
    seen = set()
    stack = [start_id]
    while stack:
        cur = stack.pop()
        for nb in live_adj.get(cur, []):
            if nb not in seen:
                seen.add(nb)
                stack.append(nb)
    return list(seen)


def _collect_repo_patch_lines(live_graph, repo_id):
    repo_diff = (live_graph.get('diffs') or {}).get(repo_id, {})
    patches = repo_diff.get('patches', [])
    added_lines = []
    removed_lines = []
    touched_files = []
    for patch in patches:
        touched_files.append(patch.get('path', ''))
        for line in (patch.get('diff') or '').splitlines():
            if line.startswith('+++') or line.startswith('---') or line.startswith('@@'):
                continue
            if line.startswith('+'):
                added_lines.append(line[1:].strip())
            elif line.startswith('-'):
                removed_lines.append(line[1:].strip())
    return {
        'touched_files': [path for path in touched_files if path],
        'added_lines': added_lines,
        'removed_lines': removed_lines,
    }


def _terraform_change_summary(repo_id, live_graph):
    patch_lines = _collect_repo_patch_lines(live_graph, repo_id)
    added_lines = patch_lines['added_lines']
    removed_lines = patch_lines['removed_lines']
    touched_files = patch_lines['touched_files']
    resource_pattern = re.compile(r'resource\s+"([^"]+)"\s+"([^"]+)"')
    resources_added = []
    resources_removed = []
    for line in added_lines:
        match = resource_pattern.search(line)
        if match:
            resources_added.append({'type': match.group(1), 'name': match.group(2)})
    for line in removed_lines:
        match = resource_pattern.search(line)
        if match:
            resources_removed.append({'type': match.group(1), 'name': match.group(2)})
    significant_terms = ['instance_class', 'instance_type', 'source', 'version', 'encryption', 'kms', 'public', 'acl']
    parameter_updates = []
    for line in added_lines:
        if any(term in line.lower() for term in significant_terms):
            parameter_updates.append(line)
    return {
        'status': 'completed',
        'touched_files': touched_files,
        'added_line_count': len(added_lines),
        'removed_line_count': len(removed_lines),
        'resources_added': resources_added,
        'resources_removed': resources_removed,
        'parameter_updates': parameter_updates[:12],
        'raw_added_lines': added_lines,
        'raw_removed_lines': removed_lines,
    }


def _security_impact(terraform_change):
    added_lines = [line.lower() for line in terraform_change.get('raw_added_lines', [])]
    removed_lines = [line.lower() for line in terraform_change.get('raw_removed_lines', [])]
    findings = []
    score = 0

    if any('0.0.0.0/0' in line for line in added_lines):
        findings.append('Open ingress pattern detected (0.0.0.0/0) in proposed change.')
        score += 25
    if any('public' in line for line in added_lines):
        findings.append('Public exposure keyword detected in added Terraform lines.')
        score += 15
    if any('encryption' in line or 'kms' in line for line in added_lines):
        findings.append('Encryption/KMS controls added or modified.')
        score += 8
    if any('iam' in line for line in added_lines + removed_lines):
        findings.append('IAM-related definitions changed, validate least privilege.')
        score += 10
    if not findings:
        findings.append('No high-risk Terraform security pattern detected in simulated diff.')

    if score >= 35:
        severity = 'high'
    elif score >= 18:
        severity = 'medium'
    else:
        severity = 'low'

    return {
        'status': 'completed',
        'severity': severity,
        'security_score': min(100, score),
        'findings': findings,
    }


def _extract_known_cost_tokens(lines):
    token_pattern = re.compile(r'"([A-Za-z0-9._-]+)"')
    tokens = []
    for line in lines:
        for match in token_pattern.findall(line):
            tokens.append(match)
    return tokens


def _cost_impact(terraform_change):
    monthly_cost_map = {
        'db.t3.micro': 15.0,
        'db.t3.small': 30.0,
        'db.t3.medium': 60.0,
        'db.m5.2xlarge': 460.0,
        't3.micro': 8.0,
        't3.small': 16.0,
        'm5.large': 70.0,
        'm5.4xlarge': 560.0,
    }
    removed_tokens = _extract_known_cost_tokens(terraform_change.get('raw_removed_lines', []))
    added_tokens = _extract_known_cost_tokens(terraform_change.get('raw_added_lines', []))
    known_removed = [token for token in removed_tokens if token in monthly_cost_map]
    known_added = [token for token in added_tokens if token in monthly_cost_map]

    replaced = []
    delta = 0.0
    for old, new in zip(known_removed, known_added):
        old_cost = monthly_cost_map[old]
        new_cost = monthly_cost_map[new]
        delta += (new_cost - old_cost)
        replaced.append({
            'from': old,
            'to': new,
            'monthly_delta_usd': round(new_cost - old_cost, 2),
        })

    estimated_savings = round(max(0.0, -delta), 2)
    estimated_increase = round(max(0.0, delta), 2)
    return {
        'status': 'completed',
        'resource_replacements': replaced,
        'estimated_monthly_savings_usd': estimated_savings,
        'estimated_monthly_increase_usd': estimated_increase,
        'summary': 'Potential savings identified' if estimated_savings > 0 else ('Potential cost increase identified' if estimated_increase > 0 else 'No measurable cost delta from known instance classes'),
    }


def build_approval_intelligence(repo_id):
    live_graph = get_live_graph_state()
    repo_detail = live_graph.get('repo_details', {}).get(repo_id, {})
    pg_context = {'status': 'failed', 'error': 'unavailable'}
    neo_context = {'status': 'failed', 'error': 'unavailable'}
    vector_context = {'status': 'failed', 'error': 'unavailable'}

    try:
        pg_context = postgres_repo_context(repo_id)
    except Exception as exc:
        pg_context = {'status': 'failed', 'error': str(exc)}

    try:
        neo_context = neo4j_repo_risk(repo_id)
    except Exception as exc:
        neo_context = {'status': 'failed', 'error': str(exc)}

    try:
        vector_context = milvus_repo_neighbors(repo_id, live_graph, top_k=5)
    except Exception as exc:
        vector_context = {'status': 'failed', 'error': str(exc), 'neighbors': []}

    downstream_count = int((neo_context.get('downstream_count') or pg_context.get('downstream_count') or 0))
    out_of_sync_count = int((neo_context.get('out_of_sync_count') or pg_context.get('out_of_sync_downstream_count') or 0))
    average_match = float(neo_context.get('average_match_pct') or 0)
    neighbors = vector_context.get('neighbors', []) or []
    similarity_pressure = sum(1 for neighbor in neighbors if float(neighbor.get('similarity', 0)) >= 0.9)
    cycle_flag = bool(repo_detail.get('cycle', False))
    terraform_change = _terraform_change_summary(repo_id, live_graph)
    security_impact = _security_impact(terraform_change)
    cost_impact = _cost_impact(terraform_change)

    risk_score = 25
    risk_score += min(30, downstream_count * 5)
    risk_score += min(25, out_of_sync_count * 8)
    risk_score += min(10, similarity_pressure * 3)
    if average_match < 75:
        risk_score += 10
    if cycle_flag:
        risk_score += 8
    if security_impact.get('severity') == 'high':
        risk_score += 15
    elif security_impact.get('severity') == 'medium':
        risk_score += 8
    risk_score += min(8, int(cost_impact.get('estimated_monthly_increase_usd', 0) // 5))
    risk_score = max(0, min(100, int(risk_score)))

    if risk_score >= 75:
        recommendation = 'manual_review_required'
    elif risk_score >= 50:
        recommendation = 'approve_with_guardrails'
    else:
        recommendation = 'approve_safe'

    rationale = [
        f'Downstream repos impacted: {downstream_count}',
        f'Out-of-sync downstream edges: {out_of_sync_count}',
        f'Average dependency match: {round(average_match, 2)}%',
        f'High-similarity vector neighbors: {similarity_pressure}',
        f'Cycle detected: {"yes" if cycle_flag else "no"}',
        f'Security severity: {security_impact.get("severity")}',
        f'Estimated monthly savings: ${cost_impact.get("estimated_monthly_savings_usd", 0)}',
        f'Estimated monthly increase: ${cost_impact.get("estimated_monthly_increase_usd", 0)}',
    ]

    return {
        'repo': repo_id,
        'risk_score': risk_score,
        'recommendation': recommendation,
        'rationale': rationale,
        'postgres': pg_context,
        'neo4j': neo_context,
        'milvus': vector_context,
        'terraform_change': terraform_change,
        'security_impact': security_impact,
        'cost_impact': cost_impact,
        'repo_detail': repo_detail,
    }


# --- Server-Sent Events support ---
subscribers = []
sub_lock = threading.Lock()

def send_event(event_type, data):
    payload = 'event: {}\n'.format(event_type)
    payload += 'data: {}\n\n'.format(json.dumps(data))
    with sub_lock:
        for q in list(subscribers):
            try:
                q.put(payload, block=False)
            except Exception:
                pass

@app.route('/api/stream')
def stream():
    def gen(q):
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    yield msg
                except queue.Empty:
                    yield ': keepalive\n\n'
        except GeneratorExit:
            with sub_lock:
                if q in subscribers:
                    subscribers.remove(q)
            return

    q = queue.Queue()
    with sub_lock:
        subscribers.append(q)
    response = Response(gen(q), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Connection'] = 'keep-alive'
    return response


@app.route('/api/config')
def get_config():
    return jsonify(get_platform_links())


@app.route('/api/sample_repo_list')
def get_sample_repo_list():
    sample_root = Path(__file__).resolve().parents[1] / 'sample_repos'
    repo_names = [
        'upstream-core-network-modules',
        'upstream-core-k8s-modules',
        'upstream-core-database-modules',
        'upstream-core-storage-modules',
        'team-k8s-runtime-infra',
        'team-database-platform-infra',
        'team-storage-platform-infra',
        'repo-a', 'repo-b', 'repo-c', 'repo-d', 'repo-e',
        'repo-f', 'repo-g', 'repo-h', 'repo-i', 'repo-j'
    ]
    repo_paths = [str((sample_root / name)).replace('\\', '/') for name in repo_names if (sample_root / name).exists()]
    return jsonify({'repos': repo_paths})


@app.route('/api/clear_platform_data', methods=['POST'])
def clear_platform_data():
    platform_results = clear_all_platforms()
    cleared_state = empty_graph_state()
    persist_graph_state(cleared_state)
    payload = {
        'status': 'cleared',
        'nodes': 0,
        'edges': 0,
        'vector_count': 0,
        'vector_db': build_vector_db_details(0, 0, 0),
        'pg_tables': build_postgres_tables(0, 0, 0, 0),
        'platform_sync': build_platform_sync_state(platform_results),
        'message': 'Neo4j, Milvus, and PostgreSQL demo data cleared',
    }
    send_event('platform_cleared', payload)
    return jsonify(payload)

@app.route('/api/graph')
def get_graph():
    return jsonify(get_live_graph_state())

@app.route('/api/stats')
def stats():
    repo = request.args.get('repo')
    live_graph = get_live_graph_state()
    live_node_map = {n['id']: n for n in live_graph.get('nodes', [])}
    if not repo or repo not in live_node_map:
        return jsonify({'error': 'repo query param required and must exist'}), 400
    affected = None
    if neo4j_sync_configured():
        try:
            affected = descendants_from_neo4j(repo)
        except Exception:
            affected = None
    if affected is None:
        affected = descendants_from_graph(live_graph, repo)
    total = len(live_graph.get('nodes', []))
    pct = round(len(affected) / total * 100, 2)
    return jsonify({'repo': repo, 'affected_count': len(affected), 'total_repos': total, 'percent_affected': pct, 'affected': affected})


@app.route('/api/neo4j_insights')
def neo4j_insights():
    repo = request.args.get('repo')
    if not neo4j_sync_configured():
        return jsonify({'status': 'not_configured', 'error': 'NEO4J_BOLT_URL is not configured', 'queries': []})
    try:
        payload = neo4j_dependency_insights(repo_id=repo)
        payload['status'] = 'completed'
        return jsonify(payload)
    except Exception as exc:
        return jsonify({'status': 'failed', 'error': str(exc), 'queries': []}), 500


@app.route('/api/approval_insight')
def approval_insight():
    repo = request.args.get('repo')
    live_graph = get_live_graph_state()
    live_node_map = {n['id']: n for n in live_graph.get('nodes', [])}
    if not repo or repo not in live_node_map:
        return jsonify({'error': 'repo query param required and must exist'}), 400
    insight = build_approval_intelligence(repo)
    return jsonify({'status': 'completed', 'insight': insight})

@app.route('/api/approve', methods=['POST'])
def approve():
    data = request.get_json()
    repo = data.get('repo')
    live_graph = get_live_graph_state()
    live_node_map = {n['id']: n for n in live_graph.get('nodes', [])}
    if not repo or repo not in live_node_map:
        return jsonify({'error': 'repo required and must exist'}), 400
    approval_context = build_approval_intelligence(repo)
    # mark repo as approved (clear change_pending)
    if repo in node_map:
        node_map[repo]['change_pending'] = False
    # recompute graph['nodes'] for clients
    graph['nodes'] = list(node_map.values())
    # For demo, write back to file so state persists
    with open(DATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2)
    approval_sync = {
        'neo4j': run_platform_sync('neo4j', sync_neo4j, graph),
        'postgres': run_platform_sync('postgres', sync_postgres, graph),
        'milvus': run_platform_sync('milvus', sync_milvus, graph),
    }
    # notify subscribers
    send_event('approve', {'repo': repo, 'insight': approval_context, 'platform_sync': build_platform_sync_state(approval_sync)})
    return jsonify({'status': 'approved', 'repo': repo, 'insight': approval_context, 'platform_sync': build_platform_sync_state(approval_sync)})


@app.route('/api/simulate', methods=['POST'])
def simulate_apply():
    data = request.get_json()
    repo = data.get('repo')
    live_graph = get_live_graph_state()
    live_node_map = {n['id']: n for n in live_graph.get('nodes', [])}
    if not repo or repo not in live_node_map:
        return jsonify({'error': 'repo required and must exist'}), 400

    def run_sim(start):
        # include the start repo as applied first
        impacted = None
        if neo4j_sync_configured():
            try:
                impacted = descendants_from_neo4j(start)
            except Exception:
                impacted = None
        if impacted is None:
            impacted = descendants_from_graph(graph, start)
        apply_order = [start] + [repo_id for repo_id in impacted if repo_id != start]
        total = len(apply_order)
        for i, r in enumerate(apply_order, start=1):
            # simulate applying change
            if r in node_map:
                node_map[r]['change_pending'] = False
            graph['nodes'] = list(node_map.values())
            with open(DATA_PATH, 'w', encoding='utf-8') as f:
                json.dump(graph, f, indent=2)
            pct = round(i / total * 100, 2)
            # include diff info if available
            diff = graph.get('diffs', {}).get(r)
            validation = validate_repo_iac(r)
            send_event('simulate_step', {'repo': r, 'index': i, 'total': total, 'percent': pct, 'diff': diff, 'validation': validation})
            time.sleep(1)
        send_event('simulate_done', {'repo': start, 'total': total})

    thread = threading.Thread(target=run_sim, args=(repo,), daemon=True)
    thread.start()
    return jsonify({'status': 'simulation_started', 'repo': repo}), 202

@app.route('/api/upload', methods=['POST'])
def upload_repos():
    try:
        data = request.get_json()
        repo_text = data.get('repos', '')
        repo_list = data.get('repo_list', '')
        repo_inputs = []
        if repo_text.strip():
            repo_inputs = [line.strip() for line in repo_text.splitlines() if line.strip()]
        elif repo_list:
            repo_inputs = [item.strip() for item in repo_list if item.strip()]

        if not repo_inputs:
            return jsonify({'error': 'repos input is required'}), 400

        # parse local repo paths or simple repo list
        if any(Path(item).is_dir() for item in repo_inputs):
            parsed = parse_repos(repo_inputs)
        else:
            parsed = parse_repo_list('\n'.join(repo_inputs))

        next_graph = dict(graph)
        next_graph['nodes'] = parsed['nodes']
        next_graph['edges'] = parsed['edges']
        next_graph['repo_details'] = parsed.get('repo_details', {})
        next_graph['cycles'] = parsed.get('cycles', [])
        next_graph['diffs'] = build_repo_diffs(next_graph['repo_details'])
        persist_graph_state(next_graph)

        total_nodes = len(parsed['nodes'])
        total_edges = len(parsed['edges'])
        total_vectors = total_nodes
        cycle_count = len(graph.get('cycles', []))
        platform_results = {}

        # broadcast analysis steps to the UI
        send_event('upload_step', {'step': 1, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Parsing repo list', 'detail': f'{total_nodes} repos parsed from input'})
        send_event('upload_progress', {'step': 1, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 12, 'message': 'Parsing repo list', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 1), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 1), 'platform_sync': build_platform_sync_state(platform_results)})
        time.sleep(0.5)
        send_event('upload_step', {'step': 2, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Building dependency hierarchy', 'detail': f'{len(parsed["edges"])} parent/dependent relationships identified'})
        send_event('upload_progress', {'step': 2, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 24, 'message': 'Building dependency hierarchy', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 2), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 2), 'platform_sync': build_platform_sync_state(platform_results)})
        time.sleep(0.5)
        send_event('upload_step', {'step': 3, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Syncing Neo4j graph', 'detail': 'Writing repo nodes and dependency edges into Neo4j'})
        platform_results['neo4j'] = run_platform_sync('neo4j', sync_neo4j, graph)
        send_event('upload_progress', {'step': 3, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 40, 'message': 'Syncing Neo4j graph', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 3), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 2), 'platform_sync': build_platform_sync_state(platform_results)})
        time.sleep(0.5)
        send_event('upload_step', {'step': 4, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Syncing PostgreSQL metadata', 'detail': 'Upserting repo catalog, dependency edges, files, and cycle registry tables'})
        platform_results['postgres'] = run_platform_sync('postgres', sync_postgres, graph)
        send_event('upload_progress', {'step': 4, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 56, 'message': 'Syncing PostgreSQL metadata', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 3), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 3), 'platform_sync': build_platform_sync_state(platform_results)})
        time.sleep(0.5)
        send_event('upload_step', {'step': 5, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Syncing Milvus vectors', 'detail': 'Refreshing vector collection for repository similarity and retrieval'})
        platform_results['milvus'] = run_platform_sync('milvus', sync_milvus, graph)
        send_event('upload_progress', {'step': 5, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 72, 'message': 'Syncing Milvus vectors', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 5), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 3), 'platform_sync': build_platform_sync_state(platform_results)})
        time.sleep(0.5)
        send_event('upload_step', {'step': 6, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Detecting cycles', 'detail': f'{cycle_count} circular dependency paths detected'})
        send_event('upload_progress', {'step': 6, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 88, 'message': 'Detecting cycles', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': build_vector_db_details(total_nodes, total_edges, 6), 'pg_tables': build_postgres_tables(total_nodes, total_edges, cycle_count, 4), 'platform_sync': build_platform_sync_state(platform_results)})

        # AI ranking
        send_event('upload_step', {'step': 7, 'total_steps': TOTAL_UPLOAD_STEPS, 'name': 'Finalizing ranking and state', 'detail': 'Computing AI risk ranking and completing platform synchronization'})
        rankings = rank_repos(graph['nodes'])
        final_pg_tables = build_postgres_tables(total_nodes, total_edges, cycle_count, TOTAL_UPLOAD_STEPS)
        final_vector_db = build_vector_db_details(total_nodes, total_edges, TOTAL_UPLOAD_STEPS)
        send_event('upload_done', {'step': TOTAL_UPLOAD_STEPS, 'total_steps': TOTAL_UPLOAD_STEPS, 'total_repos': total_nodes, 'total_edges': total_edges, 'vector_count': total_vectors, 'vector_db': final_vector_db, 'platform_sync': build_platform_sync_state(platform_results), 'ranking': rankings, 'cycle_count': cycle_count, 'pg_tables': final_pg_tables})
        send_event('upload_progress', {'step': TOTAL_UPLOAD_STEPS, 'total_steps': TOTAL_UPLOAD_STEPS, 'percent': 100, 'message': 'Repo knowledge build complete', 'nodes': total_nodes, 'edges': total_edges, 'vector_count': total_vectors, 'vector_db': final_vector_db, 'pg_tables': final_pg_tables, 'platform_sync': build_platform_sync_state(platform_results)})
        return jsonify({'status': 'upload_processed', 'repos': [n['id'] for n in parsed['nodes']], 'ranking': rankings, 'platform_sync': build_platform_sync_state(platform_results)})
    except Exception as exc:
        error_msg = str(exc)
        trace = traceback.format_exc()
        print('UPLOAD ERROR', error_msg)
        print(trace)
        return jsonify({'error': 'Upload failed', 'details': error_msg, 'trace': trace}), 500

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)
