#!/usr/bin/env bash
# Copies the public project page (README, license, legal texts, artwork) to the public
# repository. The source code is never copied there.
set -euo pipefail
PUB="https://x-access-token:${PUBLIC_REPO_TOKEN}@github.com/vasileiostripolidis/flipleaf.git"
rm -rf /tmp/pub
if git ls-remote --exit-code "$PUB" main >/dev/null 2>&1; then git clone -q --depth 1 "$PUB" /tmp/pub; else mkdir /tmp/pub && git -C /tmp/pub init -q -b main; fi
cd /tmp/pub
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
mkdir -p legal .github
cp "$GITHUB_WORKSPACE/public/README.md" README.md
cp "$GITHUB_WORKSPACE/LICENSE" LICENSE
cp "$GITHUB_WORKSPACE"/legal/{EULA.md,PRIVACY.md,THIRD-PARTY-NOTICES.txt} legal/
cp -r "$GITHUB_WORKSPACE/.github/assets" .github/assets
cp "$GITHUB_WORKSPACE/.github/SECURITY.md" .github/SECURITY.md
git add -A
if git diff --cached --quiet; then echo "Public page unchanged."; exit 0; fi
git -c user.name="Vasileios Tripolidis" -c user.email="121127677+vasileiostripolidis@users.noreply.github.com" commit -qm "Update project page"
git push -q "$PUB" HEAD:main
echo "Public page published."
