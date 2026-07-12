#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Dhamotharanjan/tfEngineering.git"
BRANCH="main"
COMMIT_MESSAGE="Initial import: TF and TG Engineering Knowledge"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"
echo "Project root: ${PROJECT_ROOT}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed or not available in PATH"
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "Initializing git repository..."
  git init
fi

if ! git config user.name >/dev/null; then
  echo "Configuring local git user.name"
  git config user.name "Dhamotharanjan"
fi

if ! git config user.email >/dev/null; then
  echo "Configuring local git user.email"
  git config user.email "dhamotharanjan@example.com"
fi

if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_REMOTE="$(git remote get-url origin)"
  if [[ "${CURRENT_REMOTE}" != "${REPO_URL}" ]]; then
    echo "Updating origin from ${CURRENT_REMOTE} to ${REPO_URL}"
    git remote set-url origin "${REPO_URL}"
  fi
else
  echo "Adding origin remote: ${REPO_URL}"
  git remote add origin "${REPO_URL}"
fi

echo "Staging files..."
git add .

if ! git diff --cached --quiet; then
  echo "Creating commit..."
  git commit -m "${COMMIT_MESSAGE}"
else
  echo "No staged changes to commit."
fi

echo "Setting branch: ${BRANCH}"
git branch -M "${BRANCH}"

echo "Pushing to origin/${BRANCH}"
git push -u origin "${BRANCH}"

echo "Upload complete."
