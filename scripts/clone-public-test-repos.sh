#!/usr/bin/env bash
# Shallow-clone public Terraform/Terragrunt test repos into mvp_demo/public_repos/
# Usage: ./scripts/clone-public-test-repos.sh [repo-id ...]
#   Pass repo IDs to clone a subset; omit to clone all repos from config.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config/public-test-repos.json"
CLONE_ROOT="$ROOT/mvp_demo/public_repos"
FORCE="${FORCE:-false}"

if [[ ! -f "$CONFIG" ]]; then
  echo "Config not found: $CONFIG" >&2
  exit 1
fi

mkdir -p "$CLONE_ROOT"

# Parse repo entries with jq if available, otherwise use python
read_repos() {
  if command -v jq >/dev/null 2>&1; then
    if [[ $# -gt 0 ]]; then
      ids_json=$(printf '%s\n' "$@" | jq -R . | jq -s .)
      jq -c --argjson ids "$ids_json" '.repos[] | select(.id as $id | $ids | index($id))' "$CONFIG"
    else
      jq -c '.repos[]' "$CONFIG"
    fi
  else
    python3 - "$CONFIG" "$@" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
ids = set(sys.argv[2:])
for repo in config["repos"]:
    if not ids or repo["id"] in ids:
        print(json.dumps(repo))
PY
  fi
}

cloned=0
skipped=0
failed=0
failed_ids=()

while IFS= read -r line; do
  id=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  branch=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['default_branch'])")
  url=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['clone_url'])")
  dest_rel=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['local_path_after_clone'])")
  dest="$ROOT/$dest_rel"

  if [[ -d "$dest" && "$FORCE" != "true" ]]; then
    echo "[skip] $id already exists at $dest (set FORCE=true to re-clone)"
    ((skipped++)) || true
    continue
  fi

  if [[ -d "$dest" && "$FORCE" == "true" ]]; then
    echo "[clean] Removing existing $id..."
    rm -rf "$dest"
  fi

  echo "[clone] $id ($branch) -> $dest"
  if git clone --depth 1 --branch "$branch" "$url" "$dest"; then
    ((cloned++)) || true
  else
    echo "[fail] $id" >&2
    failed_ids+=("$id")
    ((failed++)) || true
  fi
done < <(read_repos "$@")

echo ""
echo "Summary: cloned=$cloned skipped=$skipped failed=$failed"
if [[ $failed -gt 0 ]]; then
  echo "Failed repos: ${failed_ids[*]}" >&2
  echo "See mvp_demo/public_repos/README.md for manual clone commands." >&2
  exit 1
fi

echo "Done. Set subscribed=true in config/repo-subscriptions.json for cloned repos."
