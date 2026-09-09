#!/bin/bash
# Deploy a frontend build without breaking browsers that cached an older
# index.html.
#
#   bash deploy-frontend.sh                 # from the repo root, after npm run build
#
# Vite fingerprints every asset, and nginx caches those for ten years — correct,
# because the name changes whenever the content does. index.html is the index of
# those names, and it is served with no Cache-Control at all, so browsers apply
# their own heuristic and can hold a stale copy for a while.
#
# Replacing dist wholesale therefore breaks anyone mid-cache: their stale
# index.html asks for asset hashes that no longer exist, every script 404s, and
# the app fails with "Network error or server down" even though the server is
# perfectly healthy.
#
# So this copies the new build OVER the old one and keeps the previous
# generations' assets alongside it. Old hashes keep resolving until those
# clients pick up the new index.html; new hashes are always current because a
# changed file always gets a new name.
#
# Fixing this properly also needs one nginx change, which requires root:
#
#   location = /index.html {
#     add_header Cache-Control "no-cache, must-revalidate";
#   }
#
# With that, a returning browser revalidates index.html on every visit and picks
# up a new deploy immediately.

set -euo pipefail

REMOTE_USER="ohoridein"
REMOTE_HOST="173.212.241.181"
REMOTE_DIR="/home/${REMOTE_USER}/apps/oho/frontend"
KEEP_GENERATIONS=3

if [ ! -d frontend/dist ]; then
  echo "frontend/dist not found — run 'npm run build' in frontend/ first." >&2
  exit 1
fi

echo "==> packaging $(find frontend/dist -type f | wc -l) files"
TARBALL=$(mktemp -u)/dist.tar.gz
mkdir -p "$(dirname "$TARBALL")"
tar czf "$TARBALL" -C frontend dist

echo "==> uploading"
scp -q "$TARBALL" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/dist-deploy.tar.gz"
rm -f "$TARBALL"

echo "==> installing"
ssh "${REMOTE_USER}@${REMOTE_HOST}" bash -s <<REMOTE
set -euo pipefail
cd "${REMOTE_DIR}"

rm -rf dist.incoming && mkdir -p dist.incoming
tar xzf /tmp/dist-deploy.tar.gz -C dist.incoming --strip-components=1
rm -f /tmp/dist-deploy.tar.gz

# Keep this build's assets so a browser on the previous index.html can still
# load. Numbered so old generations can be pruned rather than kept forever.
if [ -d dist ]; then
  rm -rf "dist.gen.${KEEP_GENERATIONS}"
  for i in \$(seq \$((${KEEP_GENERATIONS} - 1)) -1 1); do
    [ -d "dist.gen.\$i" ] && mv "dist.gen.\$i" "dist.gen.\$((i + 1))"
  done
  cp -r dist dist.gen.1
fi

# The new build wins on every filename it defines; older hashes are only
# filled in where the new build has nothing by that name.
rm -rf dist.new && cp -r dist.incoming dist.new
for gen in dist dist.gen.1 dist.gen.2 dist.gen.3; do
  [ -d "\$gen/assets" ] && cp -rn "\$gen/assets/." dist.new/assets/ 2>/dev/null || true
done

rm -rf dist.old && [ -d dist ] && mv dist dist.old
mv dist.new dist
rm -rf dist.incoming

chmod -R a+rX dist
echo "    dist now has \$(ls dist/assets | wc -l) assets (\$(ls dist.incoming/assets 2>/dev/null | wc -l) from this build, rest retained for stale clients)"
REMOTE

echo "==> verifying"
for path in "/" "/health" "/api/v1/users/bootstrap"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "https://ohoride.in${path}")
  printf "    %-32s %s\n" "$path" "$code"
  [ "$code" = "200" ] || { echo "    FAILED — roll back with: mv dist dist.bad && mv dist.old dist" >&2; exit 1; }
done

asset=$(curl -s --max-time 20 https://ohoride.in/ | grep -oE "/assets/index-[A-Za-z0-9_-]+\.js" | head -1)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "https://ohoride.in${asset}")
printf "    %-32s %s\n" "$asset" "$code"
[ "$code" = "200" ] || exit 1

echo "==> done"
