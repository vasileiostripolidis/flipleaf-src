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

# ---- the card shown on the project page (light and dark versions)
ICONS = {
    "total": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    "windows": '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    "macos": '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
    "linux": '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
}
THEMES = {
    "dark": dict(bg="#121815", bg2="#0c110e", line="#26302b", ink="#eef3f0", muted="#8fa198", track="#1d2622"),
    "light": dict(bg="#ffffff", bg2="#f3f7f4", line="#dbe3de", ink="#14201a", muted="#5f7068", track="#e7eeea"),
}
SHADES = {"windows": "#2fbf6a", "macos": "#7fd9a2", "linux": "#1f7a45"}
FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"


def icon(name, x, y, size, color, width=2):
    k = size / 24
    return (f'<g transform="translate({x} {y}) scale({k})" fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>')


def card(theme):
    c = THEMES[theme]
    W, H = 640, 132
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">',
             f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c["bg"]}"/><stop offset="1" stop-color="{c["bg2"]}"/></linearGradient>'
             f'<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34c26f"/><stop offset="1" stop-color="#1f7a45"/></linearGradient></defs>',
             f'<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="22" fill="url(#g)" stroke="{c["line"]}"/>']
    # total
    parts.append('<rect x="24" y="24" width="56" height="56" rx="16" fill="url(#a)"/>' + icon("total", 36, 36, 32, "#ffffff", 2.2))
    parts.append(f'<text x="96" y="62" font-size="34" font-weight="700" fill="{c["ink"]}" letter-spacing="-0.5">{total:,}</text>')
    parts.append(f'<text x="97" y="82" font-size="13" font-weight="600" fill="{c["muted"]}" letter-spacing="1.4">DOWNLOADS</text>')
    # platforms
    x = 288
    for kind, label in (("windows", "Windows"), ("macos", "macOS"), ("linux", "Linux")):
        parts.append(f'<rect x="{x}" y="28" width="104" height="50" rx="14" fill="{c["track"]}"/>')
        parts.append(icon(kind, x + 12, 36, 18, SHADES[kind] if theme == "dark" or kind != "macos" else "#2fa862", 2))
        parts.append(f'<text x="{x + 36}" y="50" font-size="12" font-weight="600" fill="{c["muted"]}">{label}</text>')
        parts.append(f'<text x="{x + 12}" y="70" font-size="17" font-weight="700" fill="{c["ink"]}">{counts[kind]:,}</text>')
        x += 112
    # share of each platform
    bx, bw, by = 24, W - 48, 100
    parts.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="8" rx="4" fill="{c["track"]}"/>')
    if total:
        parts.append(f'<clipPath id="c"><rect x="{bx}" y="{by}" width="{bw}" height="8" rx="4"/></clipPath><g clip-path="url(#c)">')
        pos = bx
        for kind in ("windows", "macos", "linux"):
            w = bw * counts[kind] / total
            if w > 0:
                parts.append(f'<rect x="{pos:.1f}" y="{by}" width="{w + 0.5:.1f}" height="8" fill="{SHADES[kind]}"/>')
            pos += w
        parts.append('</g>')
    parts.append('</svg>')
    return "".join(parts)


for theme in THEMES:
    (out / f"downloads-{theme}.svg").write_text(card(theme))
(out / "summary.json").write_text(json.dumps({"total": total, **counts}, indent=2))
print(f"downloads: {total} (Windows {counts['windows']}, macOS {counts['macos']}, Linux {counts['linux']})")
