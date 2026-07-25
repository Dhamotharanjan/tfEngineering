# Docker — API image + `@infragraph/platform`

The Nest API depends on `@infragraph/platform` via `file:../../platform`. The image
build context must be the **repo root** so that path resolves and `platform/` is
available during `npm install`.

## Build

```bash
# From repo root (preferred)
docker compose build api

# Equivalent plain docker build
docker build -f apps/api/Dockerfile -t tfengineering-api .
```

## What the Dockerfile does

1. Copies `platform/` sources, runs `npm install && npm run build` (emits CJS `dist/`).
2. Installs `apps/api` (resolves `file:../../platform`), then `nest build`.
3. Production stage copies built `platform/dist`, clears platform lifecycle scripts
   (so prod `npm install` cannot run `prepare`/`tsc`), then installs API deps with
   `--omit=dev --ignore-scripts`.

`PROJECT_ROOT` stays `/app` so compose mounts (`./config` → `/app/config`) keep working;
the Nest process runs from `/app/apps/api`.

## Context hygiene

Root `.dockerignore` excludes `node_modules`, `.git`, `data/`, marketing PDFs, and
sibling apps/services so the widened context stays small.
