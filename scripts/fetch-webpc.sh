#!/usr/bin/env bash
# Add WebPC to the built site. WebPC lives in github.com/codemug/webpc; its CI publishes each
# tested build of main as the "latest-dist" release. This downloads that build, checks it against
# its published SHA-256, and extracts pc/ and third-party/ into dist/ (served at /pc/).
# Usage: npm run build && npm run webpc
set -euo pipefail
cd "$(dirname "$0")/.."
base="${WEBPC_RELEASE_URL:-https://github.com/codemug/webpc/releases/download/latest-dist}"
test -d dist || { echo "fetch-webpc: run npm run build first" >&2; exit 1; }
mkdir -p .webpc
for name in webpc-dist.tar.gz webpc-dist.tar.gz.sha256 webpc-build.json; do
  curl -fsSL --retry 3 --retry-delay 5 -o ".webpc/${name}" "${base}/${name}"
done
expected=$(tr -d ' \n' < .webpc/webpc-dist.tar.gz.sha256)
if command -v sha256sum > /dev/null; then actual=$(sha256sum .webpc/webpc-dist.tar.gz | cut -d' ' -f1)
else actual=$(shasum -a 256 .webpc/webpc-dist.tar.gz | cut -d' ' -f1); fi
if [ "$expected" != "$actual" ]; then
  echo "fetch-webpc: checksum mismatch (expected ${expected}, got ${actual}); not adding WebPC" >&2
  exit 1
fi
rm -rf dist/pc dist/third-party
tar -xzf .webpc/webpc-dist.tar.gz -C dist pc third-party
echo "fetch-webpc: added WebPC $(cat .webpc/webpc-build.json) to dist/ ($(du -sh dist/pc | cut -f1))"
