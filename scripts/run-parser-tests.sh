#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Running parser unit tests in Docker (worker-parse-test)..."
if docker compose --profile test run --rm --build worker-parse-test; then
  echo "PASS: All parser unit tests passed."
else
  ec=$?
  echo "FAIL: Parser unit tests failed (exit ${ec})."
  exit "${ec}"
fi
