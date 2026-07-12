TFEngineering session summary — 2026-07-11

- Project: TFEngineering — AI-powered engineering intelligence platform (local docker-compose stack).
- Key services: Neo4j, PostgreSQL, Milvus, MinIO, Redis, API, worker, parser, web.
- Parser: `services/parsers/parser.py` — Terraform/HCL parser; normalized HCL AST shapes; writes repo metadata to Postgres and resources to Neo4j.
- Repo-scanner: `services/repo_scanner/enqueue/enqueue_repo.py` — zips `sample_repo` and LPUSHes a job to Redis `repo_scan_queue` (job contains `zip_path` pointing to container path).
- Tests/scripts: parser test runner, MinIO upload script, Milvus dummy upsert.
- Resolved issues: HCL AST list/dict parsing bug fixed; pip dependency pin resolved; Milvus configured with MinIO object store.
- Pending next steps: implement a worker to consume `repo_scan_queue`, extract zips, run parser; optionally upload zips to MinIO and include S3 URLs in jobs.
- Last validated actions: built parser image; ran `run_tests.py`; enqueued sample repo job to Redis and inspected payload.

Tags: tfengineering, parser, repo-scanner, redis, milvus, minio, neo4j, postgres
