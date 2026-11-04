"""Counts the downloads of every Flipleaf release and writes badge files for the project page.

Counts installers only (Windows .exe/.msi, macOS .dmg, Linux .AppImage/.deb/.rpm) from the public
repository and the older releases kept in the source repository. Signature and update-manifest files
are not counted.

Usage: python download_stats.py OUT_DIR   (needs GH_TOKEN with read access to both repositories)
"""
import json, os, sys, urllib.request
from pathlib import Path

REPOS = ["vasileiostripolidis/flipleaf", "vasileiostripolidis/flipleaf-src"]
KINDS = {"windows": (".exe", ".msi"), "macos": (".dmg",), "linux": (".appimage", ".deb", ".rpm")}


def releases(repo):
    out, page = [], 1
    while True:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}",
                                     headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req) as r:
            batch = json.load(r)
        out += batch
        if len(batch) < 100:
            return out
        page += 1


counts = dict.fromkeys(KINDS, 0)
for repo in REPOS:
    for rel in releases(repo):
        for a in rel.get("assets", []):
            name = a["name"].lower()
            for kind, ends in KINDS.items():
                if name.endswith(ends):
                    counts[kind] += a["download_count"]

total = sum(counts.values())
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
badge = lambda label, n, color: {"schemaVersion": 1, "label": label, "message": f"{n:,}", "color": color, "cacheSeconds": 3600}
(out / "downloads.json").write_text(json.dumps(badge("downloads", total, "1f7a45")))
for kind, label in (("windows", "Windows"), ("macos", "macOS"), ("linux", "Linux")):
    (out / f"downloads-{kind}.json").write_text(json.dumps(badge(label, counts[kind], "3d4a43")))
(out / "summary.json").write_text(json.dumps({"total": total, **counts}, indent=2))
print(f"downloads: {total} (Windows {counts['windows']}, macOS {counts['macos']}, Linux {counts['linux']})")
