#!/usr/bin/env python3
"""Builds the legal files shipped with Flipleaf.

Run from the repository root after changing legal/EULA.md or updating dependencies:
    python3 .github/scripts/legal.py

Outputs
  src/legal/EULA.txt                 shown in the app (first run, Help menu)
  src/legal/THIRD-PARTY-NOTICES.txt  shown in the app and shipped with every build
  legal/THIRD-PARTY-NOTICES.txt      same file in the repository
  src-tauri/installer/EULA.rtf       license page of the Windows installers (accept to continue)
"""
import json, pathlib, subprocess, datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
VENDOR = ROOT / "src" / "vendor"
OUT = ROOT / "src" / "legal"
OUT.mkdir(parents=True, exist_ok=True)


def read(p):
    return pathlib.Path(p).read_text(encoding="utf-8").strip()


def rust_crates():
    """Every Rust crate compiled into the desktop app, with its declared license."""
    meta = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--format-version", "1", "--locked"],
        cwd=ROOT / "src-tauri", text=True))
    root = meta["resolve"]["root"]
    return sorted({(p["name"], p["version"], p.get("license") or "see crate")
                   for p in meta["packages"] if p["id"] != root})


SECTIONS = [
    ("Mozilla PDF.js 6.5.438", "Rendering, text layer, forms, annotations, search",
     "Copyright Mozilla Foundation and contributors", "Apache License 2.0", VENDOR / "pdfjs" / "LICENSE"),
    ("PDFium (WebAssembly build by EmbedPDF, @embedpdf/pdfium 2.15.1)", "Editing text and images inside PDF files",
     "Copyright The PDFium Authors; Foxit Software Inc.; EmbedPDF", "BSD-3-Clause and related licenses (PDFium); MIT (EmbedPDF wrapper)",
     [VENDOR / "pdfium" / "LICENSE", VENDOR / "pdfium" / "LICENSE.pdfium"]),
    ("Lucide icons", "Interface icons", "Copyright Lucide Icons and Contributors", "ISC License", ROOT / "src" / "LICENSE-lucide.txt"),
    ("Flipleaf Sans / Flipleaf Serif fonts (derived from Liberation Fonts 2.1.5)", "Fonts for text added while editing PDFs",
     "Copyright Google Corporation; Red Hat, Inc.", "SIL Open Font License 1.1", VENDOR / "fonts" / "OFL.txt"),
    ("Signature fonts: Great Vibes, Dancing Script, Caveat, EB Garamond", "Typed signatures",
     "Copyright their respective authors (see below)", "SIL Open Font License 1.1", VENDOR / "fonts" / "signature" / "OFL.txt"),
]

MIT_TEXT = """Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."""


def notices():
    bar = "=" * 79
    parts = [
        "FLIPLEAF — THIRD-PARTY NOTICES",
        f"Generated {datetime.date.today().isoformat()} by .github/scripts/legal.py",
        "",
        "Flipleaf is Copyright (c) 2026 Vasileios Tripolidis and is released under the MIT License.",
        "It includes the open-source components below. Each remains under its own license;",
        "nothing in the Flipleaf license agreement limits the rights these licenses give you.",
        "",
    ]
    for name, use, copyright, lic, files in SECTIONS:
        parts += [bar, name, f"Used for: {use}", copyright, f"License: {lic}", bar, ""]
        for f in files if isinstance(files, list) else [files]:
            parts += [read(f), ""]
    crates = rust_crates()
    parts += [bar, "Rust crates in the desktop application (Tauri 2 and its dependencies)",
              "Each crate is Copyright its respective authors and is used under the license listed.",
              "MIT and Apache-2.0 texts are reproduced below; other licenses are available in each crate's source.", bar, ""]
    w = max(len(n) for n, _, _ in crates) + 2
    parts += [f"{n.ljust(w)}{v.ljust(12)}{l}" for n, v, l in crates]
    parts += ["", bar, "MIT License (applies to the crates marked MIT above)", bar, "", MIT_TEXT, "",
              bar, "Apache License 2.0", bar, "", "See the full text in the Mozilla PDF.js section above.", ""]
    return "\n".join(parts)


def rtf(text):
    """Plain text → RTF with Unicode escapes (Greek displays correctly in the Windows installers)."""
    out = []
    for ch in text:
        o = ord(ch)
        if ch == "\\": out.append("\\\\")
        elif ch == "{": out.append("\\{")
        elif ch == "}": out.append("\\}")
        elif ch == "\n": out.append("\\par\n")
        elif o < 128: out.append(ch)
        else: out.append(f"\\u{o if o < 32768 else o - 65536}?")
    return "{\\rtf1\\ansi\\ansicpg1253\\deff0{\\fonttbl{\\f0\\fnil\\fcharset161 Segoe UI;}}\\viewkind4\\uc1\\pard\\f0\\fs18 " + "".join(out) + "\\par}"


eula = read(ROOT / "legal" / "EULA.md")
(OUT / "EULA.txt").write_text(eula + "\n", encoding="utf-8")
n = notices()
(OUT / "THIRD-PARTY-NOTICES.txt").write_text(n + "\n", encoding="utf-8")
(ROOT / "legal" / "THIRD-PARTY-NOTICES.txt").write_text(n + "\n", encoding="utf-8")
(ROOT / "src-tauri" / "installer" / "EULA.rtf").write_text(rtf(eula), encoding="ascii")
print("legal files written:", len(eula), "chars EULA,", n.count("\n"), "lines notices")
