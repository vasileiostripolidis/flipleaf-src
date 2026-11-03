"""Builds the Microsoft Store package (.msix) from the Store build of flipleaf.exe.

Usage: make_msix.py VERSION OUT_FILE
Needs the repository variables STORE_IDENTITY_NAME, STORE_PUBLISHER and
STORE_PUBLISHER_DISPLAY_NAME (from Partner Center → Product identity).
The Store signs the package itself, so it is not signed here.
"""
import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path

version, out = sys.argv[1], Path(sys.argv[2])
root = Path(__file__).resolve().parents[2]
layout = root / "msix-layout"
shutil.rmtree(layout, ignore_errors=True)
(layout / "Assets").mkdir(parents=True)

shutil.copy(root / "src-tauri/target/release/flipleaf.exe", layout / "flipleaf.exe")
for src, name in [("legal/THIRD-PARTY-NOTICES.txt", "THIRD-PARTY-NOTICES.txt"), ("legal/EULA.md", "EULA.txt"), ("LICENSE", "LICENSE.txt")]:
    shutil.copy(root / src, layout / name)
for icon in ["StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png"]:
    shutil.copy(root / "src-tauri/icons" / icon, layout / "Assets" / icon)

manifest = (root / ".github/store/AppxManifest.xml").read_text(encoding="utf-8")
for key, value in {
    "IDENTITY_NAME": os.environ["STORE_IDENTITY_NAME"],
    "PUBLISHER": os.environ["STORE_PUBLISHER"],
    "PUBLISHER_DISPLAY_NAME": os.environ["STORE_PUBLISHER_DISPLAY_NAME"],
    "VERSION": version,
}.items():
    manifest = manifest.replace("{{" + key + "}}", value)
(layout / "AppxManifest.xml").write_text(manifest, encoding="utf-8")

tools = sorted(glob.glob(r"C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64\makeappx.exe"))
if not tools:
    sys.exit("makeappx.exe not found (Windows SDK)")
out.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([tools[-1], "pack", "/d", str(layout), "/p", str(out), "/o"], check=True)
print("Store package:", out)
