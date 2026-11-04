#!/usr/bin/env bash
# Publishes the website (the protected web app built from src/ + the updater files) to the "site" branch of
# the public repository, which GitHub Pages serves at vasileiostripolidis.github.io/flipleaf.
# Usage: publish_site.sh [DIR_WITH_NEW_UPDATER_FILES]
set -euo pipefail
PUB="https://x-access-token:${PUBLIC_REPO_TOKEN}@github.com/vasileiostripolidis/flipleaf.git"
rm -rf _site /tmp/oldsite && mkdir _site
# keep the current updater files unless new ones are given
if git ls-remote --exit-code "$PUB" site >/dev/null 2>&1; then
  git clone -q --depth 1 -b site "$PUB" /tmp/oldsite
  [ -d /tmp/oldsite/updates ] && cp -r /tmp/oldsite/updates _site/
  [ -d /tmp/oldsite/stats ] && cp -r /tmp/oldsite/stats _site/
fi
node .github/scripts/protect.mjs
cp -r dist/. _site/
if [ -n "${1:-}" ]; then
  mkdir -p _site/updates
  cp "$1/latest.json" "$1/Flipleaf-macOS.app.tar.gz" _site/updates/
fi
touch _site/.nojekyll
cd _site
git init -q -b site
git add -A
git -c user.name="Vasileios Tripolidis" -c user.email="121127677+vasileiostripolidis@users.noreply.github.com" commit -qm "Website"
git push -qf "$PUB" site
echo "Website published."
