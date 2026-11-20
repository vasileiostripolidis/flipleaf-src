// Flipleaf content editor: edit the text and images that are part of the PDF itself.
// Uses PDFium (the PDF engine of Chrome, BSD/Apache licensed) compiled to WebAssembly.
//
// How it works:
//  • the current document is loaded into PDFium;
//  • every text and image object on a page gets a box the user can select, move, resize,
//    retype or delete;
//  • changed pages are re-rendered by PDFium on top of the normal view, so edits are live;
//  • "Done" saves the document from PDFium and hands the new bytes back to the viewer.

const FPDF_PAGEOBJ_TEXT = 1, FPDF_PAGEOBJ_IMAGE = 3;
const FPDF_FONT_TRUETYPE = 2;
const RENDER_FLAGS = 0x01 /* annotations */ | 0x10 /* RGBA byte order */;
const MAX_UNDO = 20;
const BASE = new URL("./vendor/", import.meta.url).href;

import { getPdfium, M, malloc, free, heap, putBytes, wstr as putString, floats, readFloats } from "./pdfium.js";
let P = null; // wrapped PDFium module

const FONT_FILES = {
  sans: { r: "FlipleafSans-Regular", b: "FlipleafSans-Bold", i: "FlipleafSans-Italic", bi: "FlipleafSans-BoldItalic" },
  serif: { r: "FlipleafSerif-Regular", b: "FlipleafSerif-Bold", i: "FlipleafSerif-Italic", bi: "FlipleafSerif-BoldItalic" },
};
const fontBytes = new Map();
async function loadFontBytes(file) {
  if (!fontBytes.has(file)) fontBytes.set(file, new Uint8Array(await (await fetch(`${BASE}fonts/${file}.ttf`)).arrayBuffer()));
  return fontBytes.get(file);
}

export function createEditor({ viewer, eventBus, t, toast, icon, onApply, onCancel, onChange, pickSignature, prepareImage, reload, onRestore }) {
  let doc = 0, docPtr = 0, form = 0, formInfo = 0;
  const pages = new Map();       // index → { page, text }
  const fonts = new Map();       // "sans-b" → FPDF_FONT
  const modified = new Set();    // page indexes re-rendered by PDFium
  const undo = [];
  let active = false, selected = null, mode = "select"; // "select" | "addText" | "placeImage"
  let originalBytes = null, pagesChanged = false; // pages deleted: the viewer shows the edited document itself
  let pending = null; // { file, widthPt } waiting for a click
  const ui = buildToolbar();

  /* ---------------------------------------------------------- document */
  let password = "";
  async function open(bytes) {
    P = await getPdfium();
    docPtr = putBytes(bytes);
    doc = P.FPDF_LoadMemDocument(docPtr, bytes.length, password);
    if (!doc) { free(docPtr); docPtr = 0; throw new Error("PDFium could not open this document (error " + P.FPDF_GetLastError() + ")"); }
    // form environment, so form fields are drawn in the live preview
    try {
      formInfo = P.PDFiumExt_OpenFormFillInfo();
      form = P.PDFiumExt_InitFormFillEnvironment(doc, formInfo);
    } catch { form = 0; }
  }
  function close() {
    for (const { page, text } of pages.values()) {
      if (text) P.FPDFText_ClosePage(text);
      if (form) P.FORM_OnBeforeClosePage(page, form);
      P.FPDF_ClosePage(page);
    }
    pages.clear();
    if (form) { P.PDFiumExt_ExitFormFillEnvironment(form); form = 0; }
    if (formInfo) { P.PDFiumExt_CloseFormFillInfo(formInfo); formInfo = 0; }
    fonts.clear(); // fonts belong to the document and are freed with it
    if (doc) P.FPDF_CloseDocument(doc);
    free(docPtr);
    doc = docPtr = 0;
  }
  function save() {
    for (const i of modified) P.FPDFPage_GenerateContent(getPage(i).page);
    const w = P.PDFiumExt_OpenFileWriter();
    try {
      if (!P.PDFiumExt_SaveAsCopy(doc, w)) throw new Error("PDFium could not save the document");
      const size = P.PDFiumExt_GetFileWriterSize(w);
      const out = malloc(size);
      P.PDFiumExt_GetFileWriterData(w, out, size);
      const bytes = heap().slice(out, out + size);
      free(out);
      return bytes;
    } finally { P.PDFiumExt_CloseFileWriter(w); }
  }
  function getPage(i) {
    let p = pages.get(i);
    if (!p) {
      const page = P.FPDF_LoadPage(doc, i);
      if (form) P.FORM_OnAfterLoadPage(page, form);
      p = { page, text: P.FPDFText_LoadPage(page) };
      pages.set(i, p);
    }
    return p;
  }
  function refreshTextPage(i) {
    const p = getPage(i);
    if (p.text) P.FPDFText_ClosePage(p.text);
    p.text = P.FPDFText_LoadPage(p.page);
  }

  /* ---------------------------------------------------------- reading objects */
  function fontInfo(font) {
    let name = "";
    const len = P.FPDFFont_GetBaseFontName(font, 0, 0);
    if (len > 0) { const b = malloc(len); P.FPDFFont_GetBaseFontName(font, b, len); name = M().UTF8ToString(b); free(b); }
    const flags = P.FPDFFont_GetFlags(font), weight = P.FPDFFont_GetWeight(font);
    const clean = name.replace(/^[A-Z]{6}\+/, "");
    return {
      name: clean,
      serif: /serif|times|roman|georgia|cambria|garamond|book|minion|palatino|tinos|libertin/i.test(clean) && !/sans/i.test(clean) || (!!(flags & 2) && !/sans|arial|helvet|calibri|verdana|segoe/i.test(clean)),
      bold: weight >= 600 || /bold|black|heavy|semibold|demi/i.test(clean),
      italic: !!(flags & 64) || /italic|oblique/i.test(clean),
    };
  }

  function objects(i) {
    const { page, text } = getPage(i);
    const n = P.FPDFPage_CountObjects(page), list = [];
    for (let k = 0; k < n; k++) {
      const obj = P.FPDFPage_GetObject(page, k), type = P.FPDFPageObj_GetType(obj);
      if (type !== FPDF_PAGEOBJ_TEXT && type !== FPDF_PAGEOBJ_IMAGE) continue;
      const b = readFloats(4, (p) => P.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
      if (!b || b[2] - b[0] < 0.5 && b[3] - b[1] < 0.5) continue;
      const item = { k, obj, type, bounds: b };
      if (type === FPDF_PAGEOBJ_TEXT) {
        if (P.FPDFTextObj_GetTextRenderMode(obj) === 3) continue; // invisible (OCR layer)
        const len = P.FPDFTextObj_GetText(obj, text, 0, 0);
        if (len > 2) { const buf = malloc(len); P.FPDFTextObj_GetText(obj, text, buf, len); item.text = M().UTF16ToString(buf); free(buf); } else item.text = "";
        if (!item.text.trim()) continue;
        item.size = readFloats(1, (p) => P.FPDFTextObj_GetFontSize(obj, p))?.[0] || 12;
        item.matrix = readFloats(6, (p) => P.FPDFPageObj_GetMatrix(obj, p)) || [1, 0, 0, 1, b[0], b[1]];
        const c = new Uint32Array(4), cp = malloc(16);
        if (P.FPDFPageObj_GetFillColor(obj, cp, cp + 4, cp + 8, cp + 12)) for (let j = 0; j < 4; j++) c[j] = M().getValue(cp + 4 * j, "i32");
        free(cp);
        item.color = `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        item.font = P.FPDFTextObj_GetFont(obj);
        Object.assign(item, fontInfo(item.font));
        item.scale = Math.hypot(item.matrix[2], item.matrix[3]) || 1; // vertical scale of the text matrix
      }
      list.push(item);
    }
    return list;
  }

  /** Characters a font is known to contain (it rendered them somewhere on this page). */
  function charsOfFont(i, font) {
    const set = new Set();
    for (const o of objects(i)) if (o.font === font) for (const ch of o.text) set.add(ch);
    return set;
  }

  /* ---------------------------------------------------------- modifying */
  function snapshot() {
    undo.push(save());
    if (undo.length > MAX_UNDO) undo.shift();
    ui.undo.disabled = false;
  }
  async function doUndo() {
    if (!undo.length) return;
    const bytes = undo.pop();
    const keep = new Set(modified);
    close();
    await open(bytes);
    for (const i of keep) modified.add(i);
    selected = null;
    ui.undo.disabled = !undo.length;
    if (pagesChanged) { modified.clear(); await reload(bytes); }
    redrawAll();
  }

  /** Deletes a whole page. The viewer is reloaded with the result (Undo brings the page back). */
  async function deletePage(i) {
    if (P.FPDF_GetPageCount(doc) <= 1) { toast(t("editLastPage")); return; }
    snapshot();
    const before = save();
    close();
    await open(before);
    P.FPDFPage_Delete(doc, i);
    const after = save();
    close();
    await open(after);
    modified.clear(); selected = null; pagesChanged = true;
    await reload(after);
    onChange?.();
    toast(t("editPageDeleted", { n: i + 1 }), 4000);
    redrawAll();
  }

  function changed(i) {
    P.FPDFPage_GenerateContent(getPage(i).page);
    refreshTextPage(i);
    modified.add(i);
    onChange?.();
    decorate(i);
  }

  async function fontFor({ serif, bold, italic }) {
    const key = `${serif ? "serif" : "sans"}-${bold ? "b" : ""}${italic ? "i" : ""}`;
    if (!fonts.has(key)) {
      const set = FONT_FILES[serif ? "serif" : "sans"];
      const file = set[bold && italic ? "bi" : bold ? "b" : italic ? "i" : "r"];
      const bytes = await loadFontBytes(file);
      const p = putBytes(bytes);
      const f = P.FPDFText_LoadFont(doc, p, bytes.length, FPDF_FONT_TRUETYPE, true);
      free(p);
      if (!f) throw new Error("Could not load font " + file);
      fonts.set(key, f);
    }
    return fonts.get(key);
  }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  async function newTextObject(text, style, matrix) {
    const font = await fontFor(style);
    const obj = P.FPDFPageObj_CreateTextObj(doc, font, style.size);
    const sp = putString(text);
    P.FPDFText_SetText(obj, sp);
    free(sp);
    const mp = floats(...matrix);
    P.FPDFPageObj_SetMatrix(obj, mp);
    free(mp);
    const [r, g, b] = hexToRgb(style.color || "#000000");
    P.FPDFPageObj_SetFillColor(obj, r, g, b, 255);
    return obj;
  }

  /** Replaces the text of an object; keeps the original font when it has all the glyphs. */
  async function setText(i, item, value, style = null) {
    const { page } = getPage(i);
    snapshot();
    const lines = value.replace(/\r/g, "").split("\n");
    if (!value.trim()) { removeObject(page, item.obj); changed(i); return; }
    const restyle = !!style;
    style ||= { serif: item.serif, bold: item.bold, italic: item.italic, size: item.size, color: item.color };
    const known = restyle ? null : charsOfFont(i, item.font);
    const canKeepFont = !restyle && lines.length === 1 && [...lines[0]].every((ch) => ch === " " || known.has(ch));
    if (canKeepFont) {
      const sp = putString(lines[0]);
      P.FPDFText_SetText(item.obj, sp);
      free(sp);
    } else {
      const m = item.matrix, size = style.size;
      let index = item.k;
      for (let l = 0; l < lines.length; l++) {
        if (!lines[l]) continue;
        const down = 1.2 * size * l; // one line lower, in text space
        const matrix = [m[0], m[1], m[2], m[3], m[4] - down * m[2], m[5] - down * m[3]];
        const obj = await newTextObject(lines[l], style, matrix);
        P.FPDFPage_InsertObjectAtIndex(page, obj, ++index);
      }
      removeObject(page, item.obj);
    }
    selected = null;
    changed(i);
  }

  function removeObject(page, obj) {
    if (P.FPDFPage_RemoveObject(page, obj)) P.FPDFPageObj_Destroy(obj);
  }

  async function addText(i, x, y, value, style) {
    const { page } = getPage(i);
    snapshot();
    const lines = value.replace(/\r/g, "").split("\n");
    const rot = P.FPDFPage_GetRotation(page) * 90;
    // keep new text upright on rotated pages
    const rad = -rot * Math.PI / 180, cos = Math.round(Math.cos(rad)), sin = Math.round(Math.sin(rad));
    for (let l = 0; l < lines.length; l++) {
      if (!lines[l]) continue;
      const down = style.size * (0.85 + 1.2 * l);
      const matrix = [cos, sin, -sin, cos, x + down * sin, y - down * cos];
      P.FPDFPage_InsertObject(page, await newTextObject(lines[l], style, matrix));
    }
    changed(i);
  }

  /** Decodes an image file and re-encodes it as PNG bytes. */
  async function toPng(file) {
    const bitmap = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bitmap.width; c.height = bitmap.height;
    c.getContext("2d").drawImage(bitmap, 0, 0);
    return { bitmap, png: new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer()) };
  }
  function setPng(page, obj, png) {
    const arr = malloc(4); M().setValue(arr, page, "i32");
    const pp = putBytes(png);
    const ok = P.EPDFImageObj_SetPng(arr, 1, obj, pp, png.length);
    free(pp); free(arr);
    return ok;
  }

  async function addImage(i, file, center, widthPt = null) {
    const { bitmap, png } = await toPng(file);
    const { page } = getPage(i);
    snapshot();
    const img = P.FPDFPageObj_NewImageObj(doc);
    if (!setPng(page, img, png)) { P.FPDFPageObj_Destroy(img); toast(t("editImageFailed")); return; }
    const pw = P.FPDF_GetPageWidthF(page), ph = P.FPDF_GetPageHeightF(page);
    let w = widthPt || Math.min(pw * 0.4, bitmap.width * 0.75), h = w * bitmap.height / bitmap.width;
    if (h > ph * 0.5) { h = ph * 0.5; w = h * bitmap.width / bitmap.height; }
    const [cx, cy] = center || [pw / 2, ph / 2];
    P.FPDFImageObj_SetMatrix(img, w, 0, 0, h, cx - w / 2, cy - h / 2);
    P.FPDFPage_InsertObject(page, img);
    changed(i);
    selectNewest(i, FPDF_PAGEOBJ_IMAGE);
  }

  async function replaceImage(i, item, file) {
    const { png } = await toPng(file);
    const { page } = getPage(i);
    snapshot();
    setPng(page, item.obj, png);
    changed(i);
  }

  function transform(i, item, m) {
    snapshot();
    P.FPDFPageObj_Transform(item.obj, ...m);
    changed(i);
  }

  /* ---------------------------------------------------------- drawing on top of the viewer */
  function pageView(i) { return viewer.getPageView(i); }

  function renderPreview(i, pv, layer) {
    const { page } = getPage(i);
    const vp = pv.viewport, dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(vp.width * dpr)), h = Math.max(1, Math.floor(vp.height * dpr));
    const rotate = (((vp.rotation / 90) - P.FPDFPage_GetRotation(page)) % 4 + 4) % 4;
    const bmp = P.FPDFBitmap_Create(w, h, 1);
    P.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
    P.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, rotate, RENDER_FLAGS);
    if (form) P.FPDF_FFLDraw(form, bmp, page, 0, 0, w, h, rotate, RENDER_FLAGS);
    const buf = P.FPDFBitmap_GetBuffer(bmp), stride = P.FPDFBitmap_GetStride(bmp);
    const img = new ImageData(w, h);
    const src = heap();
    for (let y = 0; y < h; y++) img.data.set(src.subarray(buf + y * stride, buf + y * stride + w * 4), y * w * 4);
    P.FPDFBitmap_Destroy(bmp);
    const c = document.createElement("canvas");
    c.className = "edit-preview";
    c.width = w; c.height = h;
    c.getContext("2d").putImageData(img, 0, 0);
    layer.append(c);
  }

  function screenRect(pv, b) {
    const pts = [[b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]]].map(([x, y]) => pv.viewport.convertToViewportPoint(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const left = Math.min(...xs), top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  function decorate(i) {
    if (!active) return;
    const pv = pageView(i);
    if (!pv?.div || !pv.viewport) return;
    let layer = pv.div.querySelector(":scope > .edit-layer");
    if (!layer) { layer = document.createElement("div"); layer.className = "edit-layer"; pv.div.append(layer); bindLayer(layer); }
    layer.dataset.page = i;
    layer.replaceChildren();
    layer.classList.toggle("adding", mode === "addText");
    if (modified.has(i)) renderPreview(i, pv, layer);
    const del = document.createElement("button");
    del.className = "epage-del";
    del.innerHTML = `${icon("trash-2", 15)}<span></span>`;
    del.querySelector("span").textContent = t("editDeletePage");
    del.title = t("editDeletePageN", { n: i + 1 });
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.onclick = (e) => { e.stopPropagation(); deletePage(i); };
    layer.append(del);
    for (const item of objects(i)) {
      const r = screenRect(pv, item.bounds);
      const box = document.createElement("div");
      box.className = "eobj " + (item.type === FPDF_PAGEOBJ_TEXT ? "etext" : "eimage");
      Object.assign(box.style, { left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px" });
      box.dataset.k = item.k;
      if (selected && selected.page === i && selected.k === item.k) {
        box.classList.add("sel");
        if (item.type === FPDF_PAGEOBJ_IMAGE) { const h = document.createElement("span"); h.className = "handle"; box.append(h); }
      }
      box.title = item.type === FPDF_PAGEOBJ_TEXT ? t("editHintText") : t("editHintImage");
      layer.append(box);
    }
  }
  function redrawAll() {
    for (let i = 0; i < viewer.pagesCount; i++) {
      const pv = pageView(i);
      if (pv?.div?.querySelector(".canvasWrapper canvas, .edit-layer")) decorate(i);
    }
    updateToolbar();
  }

  function itemAt(i, k) { return objects(i).find((o) => o.k === k) || null; }
  function selectedItem() { return selected ? itemAt(selected.page, selected.k) : null; }
  function select(i, k) {
    const prev = selected?.page;
    selected = k == null ? null : { page: i, k };
    if (prev != null && prev !== i) decorate(prev);
    if (i != null) decorate(i);
    updateToolbar();
  }
  function selectNewest(i, type) {
    const list = objects(i).filter((o) => o.type === type);
    if (list.length) select(i, list.at(-1).k);
  }

  /* ---------------------------------------------------------- pointer handling */
  function bindLayer(layer) {
    layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".inline-edit")) return;
      const i = +layer.dataset.page;
      const pv = pageView(i);
      const rect = layer.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;

      if (mode === "placeImage" && pending) {
        e.preventDefault();
        const [x, y] = pv.viewport.convertToPdfPoint(px, py);
        const { file, widthPt } = pending;
        pending = null;
        setMode("select");
        addImage(i, file, [x, y], widthPt).catch(() => toast(t("editImageFailed")));
        return;
      }
      if (mode === "addText") {
        e.preventDefault();
        const [x, y] = pv.viewport.convertToPdfPoint(px, py);
        setMode("select");
        openInlineEditor(layer, { left: px, top: py, width: 0, height: 0 }, "", defaultStyle(), (value, style) => value.trim() && addText(i, x, y, value, style).then(() => selectNewest(i, FPDF_PAGEOBJ_TEXT)));
        return;
      }
      const box = e.target.closest(".eobj");
      if (!box) { select(null, null); return; }
      e.preventDefault();
      const k = +box.dataset.k;
      if (!selected || selected.page !== i || selected.k !== k) select(i, k);
      const item = itemAt(i, k);
      if (!item) return;
      const target = layer.querySelector(`.eobj[data-k="${k}"]`);
      const resizing = !!e.target.closest(".handle");
      const start = { x: e.clientX, y: e.clientY }, w0 = target.offsetWidth, h0 = target.offsetHeight;
      let moved = false;
      layer.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        if (resizing) {
          const s = Math.max(0.05, Math.max((w0 + dx) / w0, (h0 + dy) / h0));
          target.style.width = w0 * s + "px"; target.style.height = h0 * s + "px";
        } else target.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const up = (ev) => {
        layer.removeEventListener("pointermove", move);
        layer.removeEventListener("pointerup", up);
        layer.removeEventListener("pointercancel", up);
        if (!moved) return;
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        const vp = pv.viewport;
        if (resizing) {
          const s = Math.max(0.05, Math.max((w0 + dx) / w0, (h0 + dy) / h0));
          const r = screenRect(pv, item.bounds);
          const [ax, ay] = vp.convertToPdfPoint(r.left, r.top);
          transform(i, item, [s, 0, 0, s, ax * (1 - s), ay * (1 - s)]);
        } else {
          const [x0, y0] = vp.convertToPdfPoint(0, 0), [x1, y1] = vp.convertToPdfPoint(dx, dy);
          transform(i, item, [1, 0, 0, 1, x1 - x0, y1 - y0]);
        }
      };
      layer.addEventListener("pointermove", move);
      layer.addEventListener("pointerup", up);
      layer.addEventListener("pointercancel", up);
    });
    layer.addEventListener("dblclick", (e) => {
      // the box may have been re-created by the first click, so fall back to the selected one
      const box = e.target.closest(".etext") || layer.querySelector(".eobj.sel.etext");
      if (box) editText(+layer.dataset.page, +box.dataset.k);
    });
  }

  function defaultStyle() {
    return { serif: ui.family.value === "serif", bold: ui.bold.getAttribute("aria-pressed") === "true", italic: ui.italic.getAttribute("aria-pressed") === "true", size: +ui.size.value || 12, color: ui.color.value };
  }

  function editText(i, k) {
    const item = itemAt(i, k);
    if (!item || item.type !== FPDF_PAGEOBJ_TEXT) return;
    const pv = pageView(i), layer = pv.div.querySelector(".edit-layer");
    const r = screenRect(pv, item.bounds);
    const style = { serif: item.serif, bold: item.bold, italic: item.italic, size: Math.round(item.size * item.scale * 10) / 10, color: item.color };
    openInlineEditor(layer, r, item.text, style, (value) => value !== item.text && setText(i, { ...item, size: item.size }, value));
  }

  function openInlineEditor(layer, r, value, style, commit) {
    layer.querySelector(".inline-edit")?.remove();
    const pv = pageView(+layer.dataset.page);
    const px = style.size * pv.viewport.scale;
    const ed = document.createElement("div");
    ed.className = "inline-edit";
    ed.contentEditable = "plaintext-only";
    if (ed.contentEditable !== "plaintext-only") ed.contentEditable = "true";
    ed.spellcheck = false;
    ed.textContent = value;
    Object.assign(ed.style, {
      left: r.left - 3 + "px", top: (r.height ? r.top - 3 : r.top) + "px", minWidth: Math.max(r.width + 6, 60) + "px",
      minHeight: Math.max(r.height + 6, px * 1.3) + "px", fontSize: px + "px",
      fontFamily: style.serif ? '"Flipleaf Serif", serif' : '"Flipleaf Sans", sans-serif',
      fontWeight: style.bold ? "700" : "400", fontStyle: style.italic ? "italic" : "normal", color: style.color,
    });
    layer.append(ed);
    ed.focus();
    const sel = getSelection(); sel.selectAllChildren(ed); if (!value) sel.collapseToEnd();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const text = ed.innerText.replace(/\n$/, "");
      ed.remove();
      if (ok) Promise.resolve(commit(text, style)).catch((e) => toast(String(e?.message || e)));
    };
    ed.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    ed.addEventListener("blur", () => finish(true));
  }

  /* ---------------------------------------------------------- toolbar */
  function buildToolbar() {
    const bar = document.getElementById("editBar");
    bar.innerHTML = `
      <span class="label">${t("editTitle")}</span>
      <button class="btn sm secondary" data-e="addText">${icon("type", 16)}<span>${t("editAddText")}</span></button>
      <button class="btn sm secondary" data-e="addImage">${icon("image-plus", 16)}<span>${t("editAddImage")}</span></button>
      <button class="btn sm secondary" data-e="addSig">${icon("signature", 16)}<span>${t("sigInsert")}</span></button>
      <div class="sep"></div>
      <select class="field sm" data-e="family"><option value="sans">Sans</option><option value="serif">Serif</option></select>
      <input class="field num sm" data-e="size" type="number" min="4" max="200" step="1" value="12" title="${t("fontSize")}">
      <button class="btn icon sm" data-e="bold" aria-pressed="false" title="Bold"><b>B</b></button>
      <button class="btn icon sm" data-e="italic" aria-pressed="false" title="Italic"><i style="font-family:serif">I</i></button>
      <input type="color" class="colorpick" data-e="color" value="#000000" title="${t("color")}">
      <div class="sep"></div>
      <button class="btn sm secondary" data-e="replace">${icon("image-plus", 16)}<span>${t("editReplace")}</span></button>
      <button class="btn icon sm" data-e="delete" title="${t("editDelete")}">${icon("trash-2", 16)}</button>
      <button class="btn sm secondary" data-e="delPage" title="${t("editDeletePageHint")}">${icon("trash-2", 16)}<span>${t("editDeletePage")}</span></button>
      <button class="btn icon sm" data-e="undo" title="${t("undo")}">${icon("undo-2", 16)}</button>
      <span class="hint muted" data-e="hint"></span>
      <div class="spacer"></div>
      <button class="btn sm secondary" data-e="cancel">${t("cancel")}</button>
      <button class="btn primary sm" data-e="done">${t("done")}</button>
      <input type="file" accept="image/*" hidden data-e="file">`;
    const q = (n) => bar.querySelector(`[data-e="${n}"]`);
    const els = Object.fromEntries(["addText", "addImage", "addSig", "family", "size", "bold", "italic", "color", "replace", "delete", "delPage", "undo", "hint", "cancel", "done", "file"].map((n) => [n, q(n)]));
    let fileTarget = "add";
    els.addText.onclick = () => setMode(mode === "addText" ? "select" : "addText");
    els.addImage.onclick = () => { fileTarget = "add"; els.file.click(); };
    els.replace.onclick = () => { fileTarget = "replace"; els.file.click(); };
    els.file.onchange = async () => {
      let f = els.file.files[0]; els.file.value = "";
      if (!f) return;
      if (prepareImage) { f = await prepareImage(f); if (!f) return; }
      try {
        if (fileTarget === "replace") { const it = selectedItem(); if (it) await replaceImage(selected.page, it, f); }
        else { pending = { file: f, widthPt: null }; setMode("placeImage"); }
      } catch { toast(t("editImageFailed")); }
    };
    els.addSig.onclick = async () => {
      const file = await pickSignature?.();
      if (file) { pending = { file, widthPt: 150 }; setMode("placeImage"); }
    };
    els.delete.onclick = () => deleteSelected();
    els.delPage.onclick = () => deletePage(viewer.currentPageNumber - 1);
    els.undo.onclick = () => doUndo();
    els.cancel.onclick = () => exit(false);
    els.done.onclick = () => exit(true);
    const toggle = (b) => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); restyleSelected(); };
    els.bold.onclick = () => toggle(els.bold);
    els.italic.onclick = () => toggle(els.italic);
    els.family.onchange = els.size.onchange = els.color.onchange = () => restyleSelected();
    return els;
  }

  function updateToolbar() {
    const it = selectedItem();
    const isText = it?.type === FPDF_PAGEOBJ_TEXT, isImg = it?.type === FPDF_PAGEOBJ_IMAGE;
    ui.replace.hidden = !isImg;
    ui.delete.disabled = !it;
    ui.undo.disabled = !undo.length;
    ui.addText.classList.toggle("on", mode === "addText");
    ui.hint.textContent = mode === "placeImage" ? t("editHintPlace") : mode === "addText" ? t("editHintAdd") : isText ? t("editHintText") : isImg ? t("editHintImage") : t("editHint");
    ui.hint.title = ui.hint.textContent;
    if (isText) {
      ui.family.value = it.serif ? "serif" : "sans";
      ui.size.value = Math.round(it.size * it.scale * 10) / 10;
      ui.bold.setAttribute("aria-pressed", it.bold);
      ui.italic.setAttribute("aria-pressed", it.italic);
      ui.color.value = it.color;
    }
  }

  async function restyleSelected() {
    const it = selectedItem();
    if (it?.type !== FPDF_PAGEOBJ_TEXT) return;
    const style = defaultStyle();
    style.size = style.size / it.scale; // size in text space
    const page = selected.page; // setText clears the selection
    await setText(page, it, it.text, style);
    selectNewest(page, FPDF_PAGEOBJ_TEXT);
  }

  function deleteSelected() {
    const it = selectedItem();
    if (!it) return;
    const i = selected.page;
    snapshot();
    removeObject(getPage(i).page, it.obj);
    selected = null;
    changed(i);
    updateToolbar();
  }

  function setMode(m) {
    mode = m;
    if (m === "addText") select(null, null);
    if (m !== "placeImage") pending = null;
    for (const l of document.querySelectorAll(".edit-layer")) l.classList.toggle("adding", m === "addText" || m === "placeImage");
    updateToolbar();
  }

  function nudge(dx, dy) {
    const it = selectedItem();
    if (!it) return;
    const pv = pageView(selected.page), vp = pv.viewport;
    const [x0, y0] = vp.convertToPdfPoint(0, 0), [x1, y1] = vp.convertToPdfPoint(dx * vp.scale, dy * vp.scale);
    transform(selected.page, it, [1, 0, 0, 1, x1 - x0, y1 - y0]);
  }

  function onKey(e) {
    if (!active || e.target.closest?.("input, select, .inline-edit, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); doUndo(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (selected) { e.preventDefault(); e.stopPropagation(); deleteSelected(); } return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (mode !== "select") setMode("select"); else if (selected) select(null, null); return; }
    if (e.key === "Enter" && selected) { e.preventDefault(); e.stopPropagation(); editText(selected.page, selected.k); return; }
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && selected) { e.preventDefault(); e.stopPropagation(); nudge(...arrows[e.key]); }
  }

  const onRendered = ({ pageNumber }) => decorate(pageNumber - 1);

  /* ---------------------------------------------------------- session */
  async function enter(bytes, pw = "") {
    password = pw || "";
    originalBytes = bytes.slice(); pagesChanged = false;
    await open(bytes);
    active = true; selected = null; mode = "select"; undo.length = 0; modified.clear();
    document.body.classList.add("editing");
    document.getElementById("editBar").hidden = false;
    eventBus.on("pagerendered", onRendered);
    addEventListener("keydown", onKey, true);
    // load the fonts' CSS faces now so the inline editor looks right
    document.fonts?.load?.('16px "Flipleaf Sans"');
    redrawAll();
  }

  async function exit(apply) {
    if (!active) return;
    let bytes = null;
    if (apply && (modified.size || undo.length)) {
      try { bytes = save(); } catch (e) { toast(String(e.message || e)); return; }
    }
    active = false;
    eventBus.off("pagerendered", onRendered);
    removeEventListener("keydown", onKey, true);
    for (const l of document.querySelectorAll(".edit-layer")) l.remove();
    document.body.classList.remove("editing");
    document.getElementById("editBar").hidden = true;
    close();
    undo.length = 0; modified.clear(); selected = null;
    const restore = !apply && pagesChanged ? originalBytes : null;
    originalBytes = null; pagesChanged = false;
    if (bytes) await onApply(bytes);
    else if (restore) await onRestore?.(restore);
    else onCancel?.();
  }

  return {
    enter, exit,
    get active() { return active; },
    addTextMode: () => setMode("addText"),
    addImageDialog: () => ui.addImage.click(),
  };
}
