import hashlib
import json
import os
import math
from contextlib import contextmanager

REPO_LABEL = 'Repo'
VECTOR_DIMENSION = int(os.environ.get('MILVUS_VECTOR_DIMENSION', '8'))


def _serialize_repo_detail(repo_id, graph):
    detail = graph.get('repo_details', {}).get(repo_id, {})
    return {
        'repo_id': repo_id,
        'description': detail.get('description', ''),
        'parents': detail.get('parents', []),
        'dependents': detail.get('dependents', []),
        'files': detail.get('files', []),
        'cycle': detail.get('cycle', False),
        'owner_team': detail.get('owner_team', 'engineering-team'),
        'repo_tier': detail.get('repo_tier', 'downstream'),
        'summary': detail.get('summary', {}),
        'parsed_fields': detail.get('parsed_fields', {}),
    }


def _vectorize_text(text, dimension=VECTOR_DIMENSION):
    digest = hashlib.sha256(text.encode('utf-8')).digest()
    values = []
    for index in range(dimension):
        byte = digest[index % len(digest)]
        values.append(round(byte / 255.0, 6))
    return values


def _relationship_health(edge):
    match_pct = int(edge.get('match_pct', 0) or 0)
    upstream_file = edge.get('upstream_file', '')
    downstream_file = edge.get('downstream_file', '')
    out_of_sync = match_pct < 75 or upstream_file != downstream_file
    reason = []
    if match_pct < 75:
        reason.append(f'attribute_match_below_threshold({match_pct}%)')
    if upstream_file != downstream_file:
        reason.append('file_mapping_differs')
    return {
        'sync_state': 'out_of_sync' if out_of_sync else 'in_sync',
        'sync_gap': max(0, 100 - match_pct),
        'drift_reason': ', '.join(reason) if reason else 'fully_aligned',
    }


def neo4j_sync_configured():
    return bool(os.environ.get('NEO4J_BOLT_URL'))


def postgres_sync_configured():
    return bool(os.environ.get('POSTGRES_DSN'))


def milvus_sync_configured():
    return bool(os.environ.get('MILVUS_SYNC_URI'))


@contextmanager
def neo4j_driver():
    from neo4j import GraphDatabase

    uri = os.environ.get('NEO4J_BOLT_URL')
    username = os.environ.get('NEO4J_USERNAME')
    password = os.environ.get('NEO4J_PASSWORD')
    if not uri:
        raise RuntimeError('NEO4J_BOLT_URL is not configured')
    auth = (username, password) if username else None
    driver = GraphDatabase.driver(uri, auth=auth)
    try:
        yield driver
    finally:
        driver.close()


@contextmanager
def postgres_connection():
    import psycopg2

    dsn = os.environ.get('POSTGRES_DSN')
    if not dsn:
        raise RuntimeError('POSTGRES_DSN is not configured')
    conn = psycopg2.connect(dsn)
    try:
        yield conn
    finally:
        conn.close()


def milvus_client():
    try:
        from pymilvus import MilvusClient
    except ImportError as exc:
        raise RuntimeError('pymilvus is not installed in this image') from exc

    uri = os.environ.get('MILVUS_SYNC_URI')
    token = os.environ.get('MILVUS_TOKEN')
    if not uri:
        raise RuntimeError('MILVUS_SYNC_URI is not configured')
    kwargs = {'uri': uri}
    if token:
        kwargs['token'] = token
    return MilvusClient(**kwargs)


def sync_neo4j(graph):
    repo_nodes = graph.get('nodes', [])
    repo_edges = graph.get('edges', [])
    managed_by = 'tfengineering'

    def merge_named_entity(session, repo_id, label, key_name, key_value, rel_type, extra_props=None):
        props = extra_props or {}
        entity_key = f'{repo_id}:{label}:{key_value}'
        query = (
            f'''MATCH (r:{REPO_LABEL} {{id: $repo_id}})
                MERGE (n:{label} {{entity_key: $entity_key}})
                SET n.name = $key_value,
                    n.repo_id = $repo_id,
                    n.managed_by = $managed_by,
                    n.metadata = $metadata
                MERGE (r)-[:{rel_type}]->(n)'''
        )
        session.run(
            query,
            {
                'repo_id': repo_id,
                'entity_key': entity_key,
                'key_value': key_value,
                'managed_by': managed_by,
                'metadata': json.dumps(props, sort_keys=True),
            },
        )

    with neo4j_driver() as driver:
        with driver.session() as session:
            session.run('MATCH (n) WHERE n.managed_by = $managed_by DETACH DELETE n', {'managed_by': managed_by})
            for node in repo_nodes:
                detail = _serialize_repo_detail(node['id'], graph)
                summary = detail.get('summary', {})
                session.run(
                    f'''MERGE (r:{REPO_LABEL} {{id: $repo_id}})
                        SET r.label = $label,
                            r.change_pending = $change_pending,
                            r.description = $description,
                            r.parents = $parents,
                            r.dependents = $dependents,
                            r.files = $files,
                            r.cycle = $cycle,
                            r.owner_team = $owner_team,
                            r.repo_tier = $repo_tier,
                            r.summary = $summary,
                            r.parsed_fields_json = $parsed_fields_json,
                            r.managed_by = $managed_by''',
                    {
                        'repo_id': node['id'],
                        'label': node['label'],
                        'change_pending': node.get('change_pending', True),
                        'description': detail['description'],
                        'parents': detail['parents'],
                        'dependents': detail['dependents'],
                        'files': detail['files'],
                        'cycle': detail['cycle'],
                        'owner_team': detail['owner_team'],
                        'repo_tier': detail['repo_tier'],
                        'summary': json.dumps(summary, sort_keys=True),
                        'parsed_fields_json': json.dumps(detail.get('parsed_fields', {}), sort_keys=True),
                        'managed_by': managed_by,
                    },
                )

                parsed_fields = detail.get('parsed_fields', {})
                for resource in parsed_fields.get('resources', []):
                    merge_named_entity(
                        session,
                        node['id'],
                        'TerraformResource',
                        'name',
                        f"{resource.get('type', 'resource')}.{resource.get('name', 'unknown')}",
                        'DECLARES_RESOURCE',
                        resource,
                    )
                for data_source in parsed_fields.get('data_sources', []):
                    merge_named_entity(
                        session,
                        node['id'],
                        'TerraformDataSource',
                        'name',
                        f"{data_source.get('type', 'data')}.{data_source.get('name', 'unknown')}",
                        'USES_DATA_SOURCE',
                        data_source,
                    )
                for variable in parsed_fields.get('variables', []):
                    merge_named_entity(session, node['id'], 'TerraformVariable', 'name', variable, 'DECLARES_VARIABLE')
                for output in parsed_fields.get('outputs', []):
                    merge_named_entity(session, node['id'], 'TerraformOutput', 'name', output, 'DECLARES_OUTPUT')
                for provider in parsed_fields.get('providers', []):
                    merge_named_entity(session, node['id'], 'TerraformProvider', 'name', provider, 'USES_PROVIDER')
                for required_provider in parsed_fields.get('required_providers', []):
                    merge_named_entity(session, node['id'], 'TerraformRequiredProvider', 'name', required_provider, 'REQUIRES_PROVIDER')
                for backend in parsed_fields.get('backend_types', []):
                    merge_named_entity(session, node['id'], 'TerraformBackend', 'name', backend, 'USES_BACKEND')
                for module in parsed_fields.get('modules', []):
                    module_name = module.get('name', 'module')
                    module_source = module.get('source', '')
                    merge_named_entity(
                        session,
                        node['id'],
                        'TerraformModule',
                        'name',
                        f'{module_name}:{module_source}',
                        'USES_MODULE',
                        module,
                    )
                for local_symbol in parsed_fields.get('locals', []):
                    merge_named_entity(session, node['id'], 'TerraformLocal', 'name', local_symbol, 'DECLARES_LOCAL')
                for tg_dep in parsed_fields.get('terragrunt_dependencies', []):
                    merge_named_entity(session, node['id'], 'TerragruntDependency', 'name', tg_dep, 'USES_TERRAGRUNT_DEPENDENCY')
                for tg_input in parsed_fields.get('terragrunt_inputs', []):
                    merge_named_entity(session, node['id'], 'TerragruntInput', 'name', tg_input, 'DECLARES_TERRAGRUNT_INPUT')
                for tg_include in parsed_fields.get('terragrunt_includes', []):
                    merge_named_entity(session, node['id'], 'TerragruntInclude', 'name', tg_include, 'INCLUDES_TERRAGRUNT')
                for remote_state_backend in parsed_fields.get('terragrunt_remote_state_backends', []):
                    merge_named_entity(session, node['id'], 'TerragruntRemoteState', 'name', remote_state_backend, 'USES_REMOTE_STATE')
            for edge in repo_edges:
                health = _relationship_health(edge)
                session.run(
                    f'''MATCH (src:{REPO_LABEL} {{id: $source_id}})
                        MATCH (dst:{REPO_LABEL} {{id: $target_id}})
                        MERGE (src)-[rel:DEPENDS_ON]->(dst)
                        SET rel.match_pct = $match_pct,
                            rel.upstream_file = $upstream_file,
                            rel.downstream_file = $downstream_file,
                            rel.sync_state = $sync_state,
                            rel.sync_gap = $sync_gap,
                            rel.drift_reason = $drift_reason''',
                    {
                        'source_id': edge['from'],
                        'target_id': edge['to'],
                        'match_pct': edge.get('match_pct', 0),
                        'upstream_file': edge.get('upstream_file', ''),
                        'downstream_file': edge.get('downstream_file', ''),
                        'sync_state': health['sync_state'],
                        'sync_gap': health['sync_gap'],
                        'drift_reason': health['drift_reason'],
                    },
                )
    return {'status': 'completed', 'nodes': len(repo_nodes), 'edges': len(repo_edges)}


def load_graph_from_neo4j(fallback_graph=None):
    fallback_graph = fallback_graph or {}
    with neo4j_driver() as driver:
        with driver.session() as session:
            node_records = session.run(
                f'''MATCH (r:{REPO_LABEL})
                    RETURN r.id AS repo_id,
                           r.label AS label,
                           coalesce(r.change_pending, true) AS change_pending,
                           coalesce(r.description, "") AS description,
                           coalesce(r.parents, []) AS parents,
                           coalesce(r.dependents, []) AS dependents,
                           coalesce(r.files, []) AS files,
                           coalesce(r.cycle, false) AS cycle
                    ORDER BY r.id'''
            )
            edge_records = session.run(
                f'''MATCH (src:{REPO_LABEL})-[rel:DEPENDS_ON]->(dst:{REPO_LABEL})
                    RETURN src.id AS source_id,
                           dst.id AS target_id,
                           coalesce(rel.match_pct, 0) AS match_pct,
                           coalesce(rel.upstream_file, "") AS upstream_file,
                           coalesce(rel.downstream_file, "") AS downstream_file
                    ORDER BY src.id, dst.id'''
            )

            nodes = []
            repo_details = {}
            cycles = []
            for record in node_records:
                repo_id = record['repo_id']
                nodes.append({
                    'id': repo_id,
                    'label': record['label'] or repo_id,
                    'change_pending': record['change_pending'],
                })
                repo_details[repo_id] = {
                    'description': record['description'],
                    'parents': list(record['parents']),
                    'dependents': list(record['dependents']),
                    'files': list(record['files']),
                    'cycle': record['cycle'],
                }
                if record['cycle']:
                    cycles.append([repo_id])

            edges = []
            for record in edge_records:
                edges.append({
                    'from': record['source_id'],
                    'to': record['target_id'],
                    'match_pct': record['match_pct'],
                    'upstream_file': record['upstream_file'],
                    'downstream_file': record['downstream_file'],
                })

    return {
        'nodes': nodes,
        'edges': edges,
        'repo_details': repo_details,
        'cycles': cycles,
        'diffs': fallback_graph.get('diffs', {}),
        'metadata': {
            'description': 'Engineering knowledge graph loaded from Neo4j.',
            'source': 'neo4j',
        },
    }


def descendants_from_neo4j(repo_id):
    with neo4j_driver() as driver:
        with driver.session() as session:
            record = session.run(
                f'''MATCH (start:{REPO_LABEL} {{id: $repo_id}})
                    OPTIONAL MATCH (start)-[:DEPENDS_ON*1..]->(dep:{REPO_LABEL})
                    RETURN collect(DISTINCT dep.id) AS affected''',
                {'repo_id': repo_id},
            ).single()
    if record is None:
        return None
    return [repo for repo in record['affected'] if repo]


def _query_rows(session, cypher, params=None):
    records = session.run(cypher, params or {})
    return [dict(record) for record in records]


def neo4j_dependency_insights(repo_id=None):
    with neo4j_driver() as driver:
        with driver.session() as session:
            summary_query = (
                f'''MATCH (r:{REPO_LABEL})
                    OPTIONAL MATCH ()-[d:DEPENDS_ON]->()
                    RETURN count(DISTINCT r) AS total_repos,
                           count(d) AS total_dependencies,
                           count(CASE WHEN d.sync_state = "out_of_sync" THEN 1 END) AS out_of_sync_dependencies'''
            )
            top_drift_query = (
                f'''MATCH (src:{REPO_LABEL})-[rel:DEPENDS_ON]->(dst:{REPO_LABEL})
                    WHERE rel.sync_state = "out_of_sync"
                    RETURN src.id AS upstream,
                           dst.id AS downstream,
                           rel.match_pct AS match_pct,
                           rel.sync_gap AS sync_gap,
                           rel.drift_reason AS drift_reason
                    ORDER BY rel.sync_gap DESC, rel.match_pct ASC
                    LIMIT 12'''
            )
            chain_query = (
                f'''MATCH p=(src:{REPO_LABEL})-[:DEPENDS_ON*2..4]->(dst:{REPO_LABEL})
                    RETURN src.id AS source,
                           dst.id AS target,
                           length(p) AS hops,
                           [n IN nodes(p) | n.id] AS path
                    ORDER BY hops DESC
                    LIMIT 8'''
            )
            repo_impact_query = (
                f'''MATCH p=(start:{REPO_LABEL} {{id: $repo_id}})-[:DEPENDS_ON*1..]->(dep:{REPO_LABEL})
                    RETURN dep.id AS impacted_repo,
                           min(length(p)) AS min_hops
                    ORDER BY min_hops ASC, impacted_repo
                    LIMIT 20'''
            )

            summary_rows = _query_rows(session, summary_query)
            drift_rows = _query_rows(session, top_drift_query)
            chain_rows = _query_rows(session, chain_query)
            impact_rows = _query_rows(session, repo_impact_query, {'repo_id': repo_id}) if repo_id else []

    return {
        'source': 'neo4j',
        'summary': summary_rows[0] if summary_rows else {},
        'queries': [
            {'name': 'Graph Summary', 'cypher': summary_query, 'rows': summary_rows},
            {'name': 'Top Out-of-Sync Dependencies', 'cypher': top_drift_query, 'rows': drift_rows},
            {'name': 'Deep Dependency Chains', 'cypher': chain_query, 'rows': chain_rows},
            {'name': f'Impacted Downstream from {repo_id}' if repo_id else 'Impacted Downstream (select a repo)', 'cypher': repo_impact_query, 'rows': impact_rows},
        ],
    }


def clear_neo4j():
    with neo4j_driver() as driver:
        with driver.session() as session:
            session.run('MATCH (n) WHERE n.managed_by = $managed_by DETACH DELETE n', {'managed_by': 'tfengineering'})
    return {'status': 'cleared'}


def sync_postgres(graph):
    repo_nodes = graph.get('nodes', [])
    repo_edges = graph.get('edges', [])
    repo_details = graph.get('repo_details', {})
    cycles = graph.get('cycles', [])
    with postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute('CREATE TABLE IF NOT EXISTS repo_catalog (repo_id TEXT PRIMARY KEY, label TEXT, change_pending BOOLEAN, description TEXT)')
            cur.execute('CREATE TABLE IF NOT EXISTS dependency_edges (source_repo TEXT, target_repo TEXT, match_pct INTEGER, upstream_file TEXT, downstream_file TEXT)')
            cur.execute('CREATE TABLE IF NOT EXISTS repo_file_inventory (repo_id TEXT, file_path TEXT)')
            cur.execute('CREATE TABLE IF NOT EXISTS cycle_registry (repo_id TEXT, cycle_path TEXT)')
            cur.execute('CREATE TABLE IF NOT EXISTS scan_audit_log (repo_id TEXT, sync_status TEXT)')
            cur.execute('TRUNCATE TABLE repo_catalog, dependency_edges, repo_file_inventory, cycle_registry, scan_audit_log')
            for node in repo_nodes:
                detail = repo_details.get(node['id'], {})
                cur.execute(
                    'INSERT INTO repo_catalog (repo_id, label, change_pending, description) VALUES (%s, %s, %s, %s)',
                    (node['id'], node['label'], node.get('change_pending', True), detail.get('description', '')),
                )
                for file_path in detail.get('files', []):
                    cur.execute('INSERT INTO repo_file_inventory (repo_id, file_path) VALUES (%s, %s)', (node['id'], file_path))
                cur.execute('INSERT INTO scan_audit_log (repo_id, sync_status) VALUES (%s, %s)', (node['id'], 'completed'))
            for edge in repo_edges:
                cur.execute(
                    'INSERT INTO dependency_edges (source_repo, target_repo, match_pct, upstream_file, downstream_file) VALUES (%s, %s, %s, %s, %s)',
                    (edge['from'], edge['to'], edge.get('match_pct', 0), edge.get('upstream_file', ''), edge.get('downstream_file', '')),
                )
            for cycle in cycles:
                cycle_path = json.dumps(cycle)
                for repo_id in cycle:
                    cur.execute('INSERT INTO cycle_registry (repo_id, cycle_path) VALUES (%s, %s)', (repo_id, cycle_path))
        conn.commit()
    return {
        'status': 'completed',
        'repo_catalog_rows': len(repo_nodes),
        'dependency_edges_rows': len(repo_edges),
        'repo_file_inventory_rows': sum(len(repo_details.get(node['id'], {}).get('files', [])) for node in repo_nodes),
        'cycle_registry_rows': sum(len(cycle) for cycle in cycles),
    }


def clear_postgres():
    with postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute('DROP TABLE IF EXISTS scan_audit_log, cycle_registry, repo_file_inventory, dependency_edges, repo_catalog')
        conn.commit()
    return {'status': 'cleared'}


def _ensure_milvus_collection(client, collection_name):
    try:
        from pymilvus import DataType
    except ImportError as exc:
        raise RuntimeError('pymilvus is not installed in this image') from exc

    if client.has_collection(collection_name=collection_name):
        return
    schema = client.create_schema(auto_id=False, enable_dynamic_field=True)
    schema.add_field(field_name='id', datatype=DataType.VARCHAR, is_primary=True, max_length=255)
    schema.add_field(field_name='vector', datatype=DataType.FLOAT_VECTOR, dim=VECTOR_DIMENSION)
    schema.add_field(field_name='repo_label', datatype=DataType.VARCHAR, max_length=255)
    client.create_collection(collection_name=collection_name, schema=schema)


def sync_milvus(graph):
    collection_name = os.environ.get('MILVUS_COLLECTION', 'engineering_repo_vectors')
    client = milvus_client()
    if client.has_collection(collection_name=collection_name):
        client.drop_collection(collection_name=collection_name)
    _ensure_milvus_collection(client, collection_name)
    rows = []
    for node in graph.get('nodes', []):
        detail = _serialize_repo_detail(node['id'], graph)
        text = ' '.join([
            node['label'],
            detail.get('description', ''),
            ' '.join(detail.get('parents', [])),
            ' '.join(detail.get('dependents', [])),
            ' '.join(detail.get('files', [])),
        ])
        rows.append({
            'id': node['id'],
            'repo_label': node['label'],
            'vector': _vectorize_text(text),
        })
    if rows:
        client.insert(collection_name=collection_name, data=rows)
    return {
        'status': 'completed',
        'collection_name': collection_name,
        'entity_count': len(rows),
        'vector_dimension': VECTOR_DIMENSION,
    }


def clear_milvus():
    collection_name = os.environ.get('MILVUS_COLLECTION', 'engineering_repo_vectors')
    client = milvus_client()
    if client.has_collection(collection_name=collection_name):
        client.drop_collection(collection_name=collection_name)
    return {'status': 'cleared'}


def _cosine_similarity(vec_a, vec_b):
    if not vec_a or not vec_b:
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return round(dot / (norm_a * norm_b), 4)


def postgres_repo_context(repo_id):
    if not postgres_sync_configured():
        return {'status': 'not_configured'}
    with postgres_connection() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT repo_id, label, change_pending, description FROM repo_catalog WHERE repo_id = %s', (repo_id,))
            catalog = cur.fetchone()
            cur.execute('SELECT target_repo, match_pct, upstream_file, downstream_file FROM dependency_edges WHERE source_repo = %s', (repo_id,))
            downstream = cur.fetchall()
            cur.execute('SELECT COUNT(*) FROM repo_file_inventory WHERE repo_id = %s', (repo_id,))
            file_count = cur.fetchone()[0]

    downstream_rows = [
        {
            'target_repo': row[0],
            'match_pct': row[1],
            'upstream_file': row[2],
            'downstream_file': row[3],
            'out_of_sync': int(row[1] or 0) < 75,
        }
        for row in downstream
    ]
    out_of_sync = sum(1 for row in downstream_rows if row['out_of_sync'])
    return {
        'status': 'completed',
        'repo_catalog': {
            'repo_id': catalog[0],
            'label': catalog[1],
            'change_pending': catalog[2],
            'description': catalog[3],
        } if catalog else None,
        'file_inventory_count': int(file_count or 0),
        'downstream_edges': downstream_rows,
        'downstream_count': len(downstream_rows),
        'out_of_sync_downstream_count': out_of_sync,
    }


def _fallback_vector_neighbors(repo_id, graph, top_k=5):
    repo_details = graph.get('repo_details', {})
    nodes = graph.get('nodes', [])
    current = next((node for node in nodes if node['id'] == repo_id), None)
    if current is None:
        return []
    current_detail = _serialize_repo_detail(repo_id, graph)
    current_text = ' '.join([
        current.get('label', ''),
        current_detail.get('description', ''),
        ' '.join(current_detail.get('parents', [])),
        ' '.join(current_detail.get('dependents', [])),
        ' '.join(current_detail.get('files', [])),
    ])
    current_vector = _vectorize_text(current_text)
    scored = []
    for node in nodes:
        if node['id'] == repo_id:
            continue
        detail = repo_details.get(node['id'], {})
        text = ' '.join([
            node.get('label', ''),
            detail.get('description', ''),
            ' '.join(detail.get('parents', [])),
            ' '.join(detail.get('dependents', [])),
            ' '.join(detail.get('files', [])),
        ])
        similarity = _cosine_similarity(current_vector, _vectorize_text(text))
        scored.append({'repo_id': node['id'], 'similarity': similarity})
    scored.sort(key=lambda entry: entry['similarity'], reverse=True)
    return scored[:top_k]


def milvus_repo_neighbors(repo_id, graph=None, top_k=5):
    if not milvus_sync_configured():
        fallback = _fallback_vector_neighbors(repo_id, graph or {}, top_k=top_k)
        return {'status': 'not_configured', 'source': 'fallback', 'neighbors': fallback}
    try:
        client = milvus_client()
        collection_name = os.environ.get('MILVUS_COLLECTION', 'engineering_repo_vectors')
        repo_record = client.query(
            collection_name=collection_name,
            filter=f'id == "{repo_id}"',
            output_fields=['id', 'repo_label', 'vector'],
            limit=1,
        )
        if not repo_record:
            fallback = _fallback_vector_neighbors(repo_id, graph or {}, top_k=top_k)
            return {'status': 'not_found', 'source': 'fallback', 'neighbors': fallback}
        vector = repo_record[0].get('vector')
        search_hits = client.search(
            collection_name=collection_name,
            data=[vector],
            limit=max(top_k + 1, 6),
            output_fields=['id', 'repo_label'],
        )
        neighbors = []
        for hit in search_hits[0] if search_hits else []:
            entity = hit.get('entity', {})
            hit_repo_id = entity.get('id') or hit.get('id')
            if hit_repo_id == repo_id:
                continue
            neighbors.append({
                'repo_id': hit_repo_id,
                'repo_label': entity.get('repo_label') or hit_repo_id,
                'similarity': round(1 - float(hit.get('distance', 0)), 4),
            })
            if len(neighbors) >= top_k:
                break
        return {'status': 'completed', 'source': 'milvus', 'neighbors': neighbors}
    except Exception as exc:
        fallback = _fallback_vector_neighbors(repo_id, graph or {}, top_k=top_k)
        return {'status': 'failed', 'error': str(exc), 'source': 'fallback', 'neighbors': fallback}


def neo4j_repo_risk(repo_id):
    if not neo4j_sync_configured():
        return {'status': 'not_configured'}
    with neo4j_driver() as driver:
        with driver.session() as session:
            summary = session.run(
                f'''MATCH (r:{REPO_LABEL} {{id: $repo_id}})
                    OPTIONAL MATCH (r)-[rel:DEPENDS_ON]->(down:{REPO_LABEL})
                    RETURN r.id AS repo_id,
                           count(down) AS downstream_count,
                           count(CASE WHEN rel.sync_state = "out_of_sync" THEN 1 END) AS out_of_sync_count,
                           coalesce(avg(rel.match_pct), 0) AS avg_match''',
                {'repo_id': repo_id},
            ).single()
            top_edges = session.run(
                f'''MATCH (r:{REPO_LABEL} {{id: $repo_id}})-[rel:DEPENDS_ON]->(down:{REPO_LABEL})
                    RETURN down.id AS downstream,
                           rel.match_pct AS match_pct,
                           rel.sync_gap AS sync_gap,
                           rel.drift_reason AS drift_reason,
                           rel.sync_state AS sync_state
                    ORDER BY rel.sync_gap DESC
                    LIMIT 8''',
                {'repo_id': repo_id},
            )
    return {
        'status': 'completed',
        'repo_id': summary['repo_id'] if summary else repo_id,
        'downstream_count': int(summary['downstream_count']) if summary else 0,
        'out_of_sync_count': int(summary['out_of_sync_count']) if summary else 0,
        'average_match_pct': round(float(summary['avg_match']), 2) if summary else 0,
        'critical_edges': [dict(row) for row in top_edges],
    }


def sync_all_platforms(graph):
    results = {}
    results['neo4j'] = sync_neo4j(graph) if neo4j_sync_configured() else {'status': 'not_configured'}
    results['postgres'] = sync_postgres(graph) if postgres_sync_configured() else {'status': 'not_configured'}
    results['milvus'] = sync_milvus(graph) if milvus_sync_configured() else {'status': 'not_configured'}
    return results


def clear_all_platforms():
    results = {}

    try:
        results['neo4j'] = clear_neo4j() if neo4j_sync_configured() else {'status': 'not_configured'}
    except Exception as exc:
        results['neo4j'] = {'status': 'failed', 'error': str(exc)}

    try:
        results['postgres'] = clear_postgres() if postgres_sync_configured() else {'status': 'not_configured'}
    except Exception as exc:
        results['postgres'] = {'status': 'failed', 'error': str(exc)}

    try:
        results['milvus'] = clear_milvus() if milvus_sync_configured() else {'status': 'not_configured'}
    except Exception as exc:
        results['milvus'] = {'status': 'failed', 'error': str(exc)}

    return results
