#!/bin/bash
# Step 3 — copy the legacy uploaded files (driver documents, profile photos,
# vehicle images) from the Laravel storage tree into the new app's uploads dir.
#
#   bash ~/apps/oho/Backend/migration/03-copy-uploads.sh
#
# Safe to re-run: rsync only copies what changed, and nothing is deleted.

set -euo pipefail

LARAVEL_STORAGE="$HOME/htdocs/storage/app/public"
LARAVEL_PUBLIC="$HOME/htdocs/public"
DEST="$HOME/apps/oho/Backend/uploads/legacy"

if [ ! -d "$LARAVEL_STORAGE" ]; then
  echo "Laravel storage not found at $LARAVEL_STORAGE" >&2
  exit 1
fi

mkdir -p "$DEST"

echo "Copying from $LARAVEL_STORAGE ..."
rsync -a --info=stats2 "$LARAVEL_STORAGE/" "$DEST/"

# Older installs of this Laravel app wrote some assets straight into public/.
for d in uploads images documents; do
  if [ -d "$LARAVEL_PUBLIC/$d" ]; then
    echo "Copying $LARAVEL_PUBLIC/$d ..."
    mkdir -p "$DEST/$d"
    rsync -a "$LARAVEL_PUBLIC/$d/" "$DEST/$d/"
  fi
done

chmod -R a+rX "$DEST"

echo
echo "Done. $(find "$DEST" -type f | wc -l) files, $(du -sh "$DEST" | cut -f1) total."
echo "Served at: https://ohoride.in/uploads/legacy/..."
