"""Writes the release page text (body.md) and the in-app updater manifest (latest.json).

Usage: release_files.py VERSION DIST_DIR   (reads the NOTES environment variable)
"""
import datetime
import json
import os
import sys
from pathlib import Path

version, dist = sys.argv[1], Path(sys.argv[2])
notes = os.environ.get("NOTES", "").strip()
repo = "https://github.com/vasileiostripolidis/flipleaf"
site = "https://vasileiostripolidis.github.io/flipleaf"
asset = f"{repo}/releases/download/v{version}"

body = []
if notes:
    body += ["### What's new", notes, ""]
body += [
    "### Downloads",
    "",
    "| | |",
    "|:--|:--|",
    f"| **Windows** 10 / 11 | [`Flipleaf-{version}-Windows.exe`]({asset}/Flipleaf-{version}-Windows.exe) |",
    f"| **macOS** 11+ (Apple silicon & Intel) | [`Flipleaf-{version}-macOS.dmg`]({asset}/Flipleaf-{version}-macOS.dmg) |",
    f"| **Linux** (any distribution) | [`Flipleaf-{version}-Linux.AppImage`]({asset}/Flipleaf-{version}-Linux.AppImage) |",
    f"| **Web** | [Open in your browser]({site}/) |",
    "",
    "> [!NOTE]",
    "> Already installed? Flipleaf updates itself: *Help → Check for updates…*",
    ">",
    "> First install: builds are not code-signed yet. **Windows:** *More info → Run anyway*. **macOS:** right-click the app → *Open*.",
    "",
    f"Offline · no telemetry · [Privacy]({repo}/blob/main/legal/PRIVACY.md) · [License]({repo}/blob/main/legal/EULA.md)",
]
(dist / "body.md").write_text("\n".join(body) + "\n", encoding="utf-8")

sig = lambda name: (dist / name).read_text().strip()
win = {"signature": sig("windows.sig"), "url": f"{asset}/Flipleaf-{version}-Windows.exe"}
mac = {"signature": sig("macos.sig"), "url": f"{site}/updates/Flipleaf-macOS.app.tar.gz"}
lin = {"signature": sig("linux.sig"), "url": f"{asset}/Flipleaf-{version}-Linux.AppImage"}
manifest = {
    "version": version,
    "notes": "\n".join(body),
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "windows-x86_64": win, "windows-x86_64-nsis": win,
        "darwin-aarch64": mac, "darwin-aarch64-app": mac,
        "darwin-x86_64": mac, "darwin-x86_64-app": mac,
        "linux-x86_64": lin, "linux-x86_64-appimage": lin,
    },
}
(dist / "latest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"body.md and latest.json written for v{version}")
