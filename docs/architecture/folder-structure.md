# Folder Structure

```text
TFEngineering/
├── apps/
│   ├── api/                  # FastAPI backend
│   ├── worker/               # Background processing workers
│   └── web/                  # React-based engineering portal
├── services/
│   ├── ingestor/             # Git provider ingestion services
│   ├── parsers/              # Terraform, Kubernetes, Helm, CI/CD parsers
│   └── ai/                   # Impact analysis and recommendation engine
├── infrastructure/
│   ├── docker/               # Container notes and runtime docs
│   ├── k8s/                  # Kubernetes deployment manifests
│   └── terraform/            # Terraform scaffolding
├── docs/
│   └── architecture/         # Architecture and implementation docs
├── scripts/                  # Start/stop scripts for local runtime
├── docker-compose.yml        # Local container orchestration
├── .env.example              # Environment template
└── README.md                 # Project overview
```
