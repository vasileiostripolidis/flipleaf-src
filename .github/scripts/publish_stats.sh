#!/usr/bin/env bash
# Updates the download counters (badge files in stats/) on the public website branch.
set -euo pipefail
PUB="https://x-access-token:${PUBLIC_REPO_TOKEN}@github.com/vasileiostripolidis/flipleaf.git"
rm -rf /tmp/site && git clone -q --depth 1 -b site "$PUB" /tmp/site
python3 .github/scripts/download_stats.py /tmp/site/stats
cd /tmp/site
git add -A stats
if git diff --cached --quiet; then echo "No change."; exit 0; fi
git -c user.name="Vasileios Tripolidis" -c user.email="121127677+vasileiostripolidis@users.noreply.github.com" commit -qm "Download counts"
git push -q "$PUB" site
echo "Download counts updated."
