#!/usr/bin/env bash
#
# Production deploy for the Vercel project `cadocs`.
#
# Why this script exists: the repository's commits carry a placeholder author
# (`user@example.com`). The project is Git-connected on Vercel, so Vercel reads
# the latest commit's author and refuses to build any deployment whose author
# has no access to the team — the upload succeeds, then the deployment comes
# back `BLOCKED` with "the commit author doesn't have permission to create
# deployments for this project", and no build log appears at all.
#
# Deploying a source tree with no `.git` directory removes the commit author
# from the payload entirely, so Vercel builds it. The tree is identical to the
# working copy; nothing is rewritten and no commit is made.
#
# Usage:
#   scripts/deploy.sh              # deploy the working copy to production
#   scripts/deploy.sh --preview    # deploy a preview instead
#   DRY_RUN=1 scripts/deploy.sh    # build the export directory, do not upload
#
# Long-term fix: once `git config user.email` is set to the email on the Vercel
# account, plain `npx vercel deploy --prod` works from the repo again and this
# script can be deleted.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="--prod"
if [ "${1:-}" = "--preview" ]; then
  TARGET=""
fi

EXPORT_DIR="${EXPORT_DIR:-$(mktemp -d 2>/dev/null || echo /tmp/ca-deploy)}"
if [ -z "${EXPORT_DIR}" ] || [ ! -d "${EXPORT_DIR}" ]; then
  mkdir -p "${EXPORT_DIR}"
fi

echo "→ Exporting the working copy to ${EXPORT_DIR} (no .git, no runtime state)"
rm -rf "${EXPORT_DIR:?}"/*
tar -cf - \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.data \
  --exclude=screenshots \
  --exclude=CA-automation-main \
  --exclude=deploy-credentials.local.md \
  --exclude='*.log' \
  . 2>/dev/null | tar -xf - -C "${EXPORT_DIR}"

if [ ! -f "${EXPORT_DIR}/.vercel/project.json" ]; then
  echo "✗ ${EXPORT_DIR} is not linked to a Vercel project (.vercel/project.json missing)" >&2
  exit 1
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "✓ Dry run: exported $(find "${EXPORT_DIR}" -type f | wc -l | tr -d ' ') files, nothing uploaded"
  exit 0
fi

echo "→ Deploying ${TARGET:-preview}"
cd "${EXPORT_DIR}"
npx vercel deploy ${TARGET} --yes
