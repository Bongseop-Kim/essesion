#!/usr/bin/env bash
set -euo pipefail

if [[ ! "${DEPLOY_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "workflow_run returned an invalid deploy SHA" >&2
  exit 1
fi

git fetch --no-tags --depth=1 origin \
  "+refs/heads/main:refs/remotes/origin/main"
main_sha="$(git rev-parse refs/remotes/origin/main)"
if [[ "$DEPLOY_SHA" != "$main_sha" ]]; then
  echo "Refusing obsolete deploy: main has advanced" >&2
  exit 1
fi
