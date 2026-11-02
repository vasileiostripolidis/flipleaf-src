<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" alt="Flipleaf icon">
</p>

<h1 align="center">Flipleaf</h1>
<p align="center"><b>A feather-light, private PDF reader and editor for Windows, macOS and Linux.</b><br>
Small installer · opens instantly · your files never leave your computer</p>

<p align="center">
  <a href="../../releases/latest"><b>⬇ Download</b></a> ·
  <a href="https://vasileiostripolidis.github.io/flipleaf/">Try it in your browser</a> ·
  <a href="#-ελληνικά">Ελληνικά</a>
</p>

---

## Download

Go to **[Releases](../../releases/latest)** and pick the file for your computer:

| Your computer | File to download |
|---|---|
| Windows 10 / 11 | `Flipleaf_…_x64-setup.exe` |
| Mac with Apple chip (M1, M2, M3, M4) | `Flipleaf_…_aarch64.dmg` |
| Mac with Intel chip | `Flipleaf_…_x64.dmg` |
| Linux | `.AppImage` (any distro), `.deb` (Ubuntu/Debian), `.rpm` (Fedora) |

Then right-click any PDF → **Open with → Flipleaf** (you can make it the default).

> **First launch.** Builds are not code-signed yet, so your system will warn you once.
> **Windows:** "Windows protected your PC" → *More info* → *Run anyway*.
> **macOS:** right-click the app → *Open* → *Open* (or run `xattr -cr /Applications/Flipleaf.app`).

## Features

**Read**
- Fast continuous scrolling; single page, two pages (book view) and scrolling variants
- Page thumbnails and bookmarks sidebar
- Zoom: automatic, actual size, fit page, fit width, 50–400 %, Ctrl + mouse wheel / trackpad pinch
- Rotate pages, full-screen presentation mode, night reading, automatic dark theme
- Read aloud (text-to-speech), starting from the current page
- Clickable links and table-of-contents entries
- Search with highlight-all, match case, whole words and accent-insensitive matching (`cafe` finds `Café`, `φυλλο` finds `ΦΎΛΛΟ`)
- Remembers the last page, zoom and rotation of every document

**Edit PDF** (Ctrl+E)
- Retype existing text, change its font, size, style and color
- Move, resize, replace or delete existing images
- Add new text and images, with live preview and undo
- Keeps the document's own font when possible; Greek, Latin and Cyrillic always supported

**Pro tools** (free during the launch period — *Tools → All tools*)
- *Edit & organize:* organize pages (drag to reorder, rotate, delete, insert blank pages or pages from other PDFs), combine files, split, extract, crop, header/footer & page numbers, watermark, Bates numbering
- *Convert:* create PDF from images, export to Word (.docx), images (PNG/JPEG) or text, reduce file size
- *Forms & signatures:* prepare forms (text fields, checkboxes, signature fields, automatic field detection)
- *Security:* password protection with AES-256 and permissions, remove security, true redaction (content is deleted, not just covered), remove hidden information
- *Comments & review:* sticky notes, comments panel, stamps, shapes (rectangle, ellipse, line, arrow), compare two versions of a document

**Comment & sign**
- Highlight text (5 colors), freehand drawing (pen colors & thickness), text boxes, images
- **Fill & Sign:** fill in PDF forms; create a signature by typing (4 signature styles), drawing, importing a photo/scan of your real signature, or generating variations; keep up to 12 saved signatures and place them with one click
- Undo / redo
- Everything is saved as standard PDF annotations, so it shows up in every other PDF reader

**Files**
- Classic menu bar: File, Edit, View, Tools, Help
- Open by double-click / *Open with*, the Open dialog, drag & drop, paste (Ctrl+V) or File → Open recent
- Save (overwrites safely) and Save as; warns before closing with unsaved changes
- Print, with your annotations and form entries
- Password-protected PDFs
- Document properties (title, author, dates, PDF version, page size…)

**Private by design:** no accounts, no telemetry, no network access. English and Greek interface.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Ctrl+O / Ctrl+S / Ctrl+Shift+S | Open / Save / Save as |
| Ctrl+E | Edit text & images |
| Ctrl+W | Close document |
| Alt | Open the menu bar |
| Ctrl+P | Print |
| Ctrl+F | Find (Enter / Shift+Enter for next / previous) |
| Ctrl++ / Ctrl+− | Zoom in / out |
| Ctrl+1 / Ctrl+0 / Ctrl+2 | Actual size / fit page / fit width |
| Ctrl+Shift++ / Ctrl+Shift+− | Rotate |
| Ctrl+L | Full screen |
| ← / → | Previous / next page |
| V / H | Select tool / hand tool |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| F4 | Sidebar |
| Ctrl+D | Document properties |
| Ctrl+Shift+Y | Read aloud |
| N | Night reading |
| ? | All shortcuts |

## Why it is so light

Most "lightweight" desktop apps built with web tech (Electron) ship a whole copy of Chrome, which is ~100 MB.
Flipleaf is built with [Tauri](https://tauri.app) and uses the browser engine **already in your operating system**: WebView2 on Windows, WebKit on macOS and Linux.

- Installer: ~5–7 MB (includes the PDFium editing engine)
- App code: plain HTML/CSS/JS + a small Rust shell, no framework
- PDF engine: Mozilla [PDF.js](https://mozilla.github.io/pdf.js/), the same one Firefox uses. Fonts, CMaps and image decoders load only when a PDF needs them

## How it works

1. You double-click a PDF. The OS starts Flipleaf and passes it the file path.
2. The Rust part (`src-tauri/src/lib.rs`) remembers that path and hands the interface **only the bytes of that file**. The UI can read or overwrite only files you opened, picked in a dialog, or that are in your recent list. It has no general access to your disk.
3. PDF.js parses the file in a background thread (Web Worker), so the window never freezes.
4. Every page gets an empty placeholder of the right size. An `IntersectionObserver` notices which pages are near the screen, and only those are drawn onto a `<canvas>`.
5. An invisible **text layer** of positioned `<span>`s sits on top of each canvas. That is what makes text selection and search highlights work.
6. Pages you scroll away from are released, to free memory.

## Build from source

You need [Node.js](https://nodejs.org) and [Rust](https://rustup.rs). On Linux you also need `libwebkit2gtk-4.1-dev librsvg2-dev`.

```bash
npm install
npm run dev      # run the app in development mode
npm run build    # make an installer in src-tauri/target/release/bundle/
```

**Installers for every platform, automatically:** push a tag (`git tag v1.1.0 && git push --tags`) or open *Actions → Release → Run workflow*.
GitHub builds Windows, macOS and Linux versions on its own machines and attaches them to a draft Release.

Web version only: `cd src && python3 -m http.server 8000`.

## Project layout

```
src/                     the app (shared by desktop and web)
  index.html, style.css  interface
  app.js                 viewer, menus, tools, find, print, presentation, read aloud
  signature.js           create, save and place signatures
  editor.js              edit text & images (PDFium)
  pro.js                 Pro tools (organize, convert, forms, security, comments)
  licensing.js           plans & feature gating (Pro is free during launch)
  pdfium.js, zip.js      PDFium helpers; ZIP and .docx writer
  legal/                 EULA and third-party notices shown in the app
  platform.js            desktop / web differences (files, dialogs, window)
  i18n.js                English & Greek text
  icons.js               Lucide icons (ISC)
  vendor/pdfjs/          Mozilla PDF.js 6.5.438 (Apache-2.0)
  vendor/pdfium/         PDFium WebAssembly (BSD-3-Clause / MIT)
  vendor/fonts/          Flipleaf Sans & Serif, signature fonts (OFL-1.1)
src-tauri/               desktop shell (Tauri 2 / Rust)
  src/lib.rs             open/save dialogs, file access, recent files, printing
  tauri.conf.json        window, security policy, .pdf association, installers
.github/workflows/       automatic builds for Windows, macOS and Linux
```

## License

- **Source code:** MIT License (`LICENSE`).
- **End-user license agreement:** `EULA.md` (English & Greek). Shown and accepted in the Windows installer and on first launch, and always available from *Help → License & third-party notices*.
- **Name and logo:** "Flipleaf" and the leaf logo are not covered by the MIT License (see EULA §3).
- **Third-party components:** `THIRD-PARTY-NOTICES.txt` — Mozilla PDF.js (Apache-2.0), PDFium (BSD-3-Clause), EmbedPDF PDFium build (MIT), Tauri and every Rust crate (MIT/Apache-2.0), Lucide icons (ISC), Liberation-derived fonts and signature fonts (OFL-1.1).
- **Privacy:** [`PRIVACY.md`](PRIVACY.md) — Flipleaf collects no data.
- **Security reports:** [`SECURITY.md`](SECURITY.md).
- Regenerate the legal files after changing `EULA.md` or dependencies: `python3 scripts/legal.py`.

---

## 🇬🇷 Ελληνικά

Το **Flipleaf** («ξεφυλλίζω») είναι ένα πολύ ελαφρύ PDF πρόγραμμα για Windows, macOS και Linux. Διαβάζεις, επεξεργάζεσαι το υπάρχον κείμενο και τις εικόνες, επισημαίνεις, σχεδιάζεις, συμπληρώνεις φόρμες, υπογράφεις, εκτυπώνεις και αποθηκεύεις. Το αρχείο εγκατάστασης είναι μικρό, δεν θέλει λογαριασμό και δεν στέλνει τίποτα στο internet. Το περιβάλλον εμφανίζεται στα ελληνικά όταν ο υπολογιστής σου είναι ρυθμισμένος στα ελληνικά.

**Κατέβασμα:** από τη σελίδα [Releases](../../releases/latest) διαλέγεις `…x64-setup.exe` για Windows, `…aarch64.dmg` για Mac με τσιπ Apple, `…x64.dmg` για Mac με Intel ή `.AppImage`/`.deb`/`.rpm` για Linux.

**Πρώτο άνοιγμα:** τα αρχεία δεν έχουν ακόμα ψηφιακή υπογραφή. Στα Windows πατάς *Περισσότερες πληροφορίες → Εκτέλεση οπωσδήποτε*. Στο Mac κάνεις δεξί κλικ στην εφαρμογή → *Άνοιγμα*.
