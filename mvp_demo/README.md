TFEngineering MVP Demo

This MVP provides a lightweight demo of repository dependency visualization and an approval workflow.

Components:
- `sample_data.json`: sample graph of repositories and directed dependencies.
- `api/app.py`: small Flask API that serves the graph, computes affected downstream repos, and provides an approval endpoint.
- `web/index.html`: single-page portal that visualizes the graph and allows approving a repo change.

Run locally (Python):

1. Create and activate a Python venv (Windows example):

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r api/requirements.txt
python api/app.py
```

Open: http://localhost:5001/

Run with Docker (recommended if you don't want to install Python locally):

```powershell
cd D:\\TFEngineering\\mvp_demo
docker compose build
docker compose up -d
# view logs
docker compose logs -f mvp_api
```

Then open http://localhost:5001/ in your browser.

Notes:
- The Docker image builds the project and runs the Flask app exposed on port 5001.
- The demo persists approval state by writing `sample_data.json` — the docker-compose mounts the host `sample_data.json` so approvals persist across container restarts.
- Next steps: add a worker service, integrate with Neo4j/Postgres, and wire embedding pipeline to Milvus.
 - Export utilities: `tools/export_csv.py` and `tools/export_neo4j_csv.py` produce CSVs in `mvp_demo/exports/` for inspection or Neo4j bulk import.

Exports example:
```powershell
python tools/export_csv.py
python tools/export_neo4j_csv.py
```

Generate sample Terraform/Terragrunt repos:
```powershell
python tools/generate_sample_repos.py
python tools/list_sample_repos.py
```

Sample repos are created under `sample_repos/` and include `.tf`, `.hcl`, and Kubernetes-style HCL references for multi-layer dependency modeling.
