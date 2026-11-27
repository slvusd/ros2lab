#!/bin/bash
# publish_web.sh — copy the browser version (web/) into a website repo folder, e.g. the GitHub Pages site at ../rov/sim
#   nodes/rov_sim/tools/publish_web.sh ../rov/sim
# It copies ONLY what the live page needs (not the tests) and writes a marker so it can safely refresh that folder later
# (it deletes files from the folder that are no longer in web/, but refuses to touch a non-empty folder it did not create).
# Then you commit and push the website repo yourself. Everything the page uses is relative, so any folder works.
set -euo pipefail
DEST="${1:?usage: publish_web.sh <destination folder, e.g. ../rov/sim>}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/web"
MARK=".published-from-ros2lab"
mkdir -p "$DEST"
if [ -n "$(ls -A "$DEST")" ] && [ ! -f "$DEST/$MARK" ]; then
  echo "refusing: $DEST is not empty and was not made by this script (no $MARK inside)" >&2; exit 1
fi
rsync -a --delete --exclude 'tests/' --exclude '.DS_Store' --exclude "$MARK" "$SRC/" "$DEST/"
REV="$(git -C "$HERE" rev-parse --short HEAD)"
DIRTY=""; [ -n "$(git -C "$HERE" status --porcelain -- "$SRC")" ] && DIRTY=" (+ uncommitted changes)"
printf 'copied from nodes/rov_sim/web of the ros2lab repo at commit %s%s on %s\nedit it there, then run tools/publish_web.sh again: changes made here are overwritten\n' "$REV" "$DIRTY" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$DEST/$MARK"
echo "published $(find "$DEST" -type f | wc -l | tr -d ' ') files to $DEST ($REV$DIRTY)"
