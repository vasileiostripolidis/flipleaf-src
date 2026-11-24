// Flipleaf content editor: edit the text and images that are part of the PDF itself.
// Uses PDFium (the PDF engine of Chrome, BSD/Apache licensed) compiled to WebAssembly.
//
// How it works:
//  • the current document is loaded into PDFium;
//  • every text and image object on a page gets a box the user can select, move, resize,
//    retype or delete;
//  • changed pages are re-rendered by PDFium on top of the normal view, so edits are live;
//  • "Done" saves the document from PDFium and hands the new bytes back to the viewer.

const FPDF_PAGEOBJ_TEXT = 1, FPDF_PAGEOBJ_PATH = 2, FPDF_PAGEOBJ_IMAGE = 3;
const SHAPES = ["line", "arrow", "rect", "fill", "ellipse"];
const MAX_PATHS = 1500; // pages with more vector pieces than this (charts, maps) only offer their text and images
const FPDF_FONT_TRUETYPE = 2;
const RENDER_FLAGS = 0x01 /* annotations */ | 0x10 /* RGBA byte order */;
const MAX_UNDO = 20;
const BASE = new URL("./vendor/", import.meta.url).href;

import { getPdfium, M, malloc, free, heap, putBytes, wstr as putString, floats, readFloats } from "./pdfium.js";
import { planGap, findGaps, planInsert, insertPoints } from "./reflow.js";
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
  let active = false, selected = null, mode = "select"; // selected: { page, ks: Set of object indexes } · mode: "select" | "addText" | "placeImage"
  const clearSelection = () => { selected = null; };
  let originalBytes = null, pagesChanged = false; // pages deleted: the viewer shows the edited document itself
  let pending = null; // { file, widthPt } waiting for a click
  let shapeKind = "line"; // the shape drawn in "drawShape" mode
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
    const W = P.FPDF_GetPageWidthF(page), H = P.FPDF_GetPageHeightF(page);
    let paths = 0;
    for (let k = 0; k < n; k++) if (P.FPDFPageObj_GetType(P.FPDFPage_GetObject(page, k)) === FPDF_PAGEOBJ_PATH) paths++;
    for (let k = 0; k < n; k++) {
      const obj = P.FPDFPage_GetObject(page, k), type = P.FPDFPageObj_GetType(obj);
      if (type !== FPDF_PAGEOBJ_TEXT && type !== FPDF_PAGEOBJ_IMAGE && !(type === FPDF_PAGEOBJ_PATH && paths <= MAX_PATHS)) continue;
      const b = readFloats(4, (p) => P.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
      if (!b || b[2] - b[0] < 0.5 && b[3] - b[1] < 0.5) continue;
      const item = { k, obj, type, bounds: b };
      if (type === FPDF_PAGEOBJ_PATH) {
        // lines, frames and shapes; not page backgrounds, and not invisible helper paths
        if ((b[2] - b[0]) * (b[3] - b[1]) > 0.6 * W * H) continue;
        const mp = malloc(8);
        const okMode = P.FPDFPath_GetDrawMode(obj, mp, mp + 4);
        const fill = M().getValue(mp, "i32"), stroke = M().getValue(mp + 4, "i32");
        free(mp);
        if (!okMode || (!fill && !stroke)) continue;
        item.filled = !!fill; item.stroked = !!stroke;
        item.color = colorOf(obj, stroke ? "Stroke" : "Fill");
        item.width = stroke ? readFloats(1, (p) => P.FPDFPageObj_GetStrokeWidth(obj, p))?.[0] || 1 : 0;
        list.push(item);
        continue;
      }
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

  function colorOf(obj, which) {
    const c = [0, 0, 0], cp = malloc(16);
    if (P["FPDFPageObj_Get" + which + "Color"](obj, cp, cp + 4, cp + 8, cp + 12)) for (let j = 0; j < 3; j++) c[j] = M().getValue(cp + 4 * j, "i32");
    free(cp);
    return `#${c.map((v) => (v & 255).toString(16).padStart(2, "0")).join("")}`;
  }

  /** Characters a font is known to contain (it rendered them somewhere on this page). */
  function charsOfFont(i, font) {
    const set = new Set();
    for (const o of objects(i)) if (o.font === font) for (const ch of o.text) set.add(ch);
    return set;
  }

  /* ---------------------------------------------------------- modifying */
  function snapshot() {
    lastGap = null; gapCache.clear(); // any other change ends the "close the gap" offer
    undo.push(save());
    if (undo.length > MAX_UNDO) undo.shift();
    ui.undo.disabled = false;
  }
  async function doUndo() {
    if (!undo.length) return;
    lastGap = null; gapCache.clear();
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

  /* ---------------------------------------------------------- closing the gap left by deleted content */
  // The layout work is in reflow.js; here the page objects are read and the plan is carried out.
  // lastGap: { page, boxes: [{ l, b, r, t }] } — what was just deleted (PDF points),
  //       or { page, at, top, bottom } — empty space the user pointed at by dragging over it
  let lastGap = null;
  const gapCache = new Map(); // page → empty spaces found on it
  const hidden = new Set();   // "page:height" of the ones the user closed the offer for

  function layoutOf(from = 0, to = P.FPDF_GetPageCount(doc) - 1) {
    const pagesOut = [], handles = new Map();
    for (let i = from; i <= to; i++) {
      const { page, text } = getPage(i);
      const objs = [];
      for (let k = 0, c = P.FPDFPage_CountObjects(page); k < c; k++) {
        const o = P.FPDFPage_GetObject(page, k), b = readFloats(4, (p) => P.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12));
        if (!b || (b[2] - b[0] < 0.05 && b[3] - b[1] < 0.05)) continue;
        const type = P.FPDFPageObj_GetType(o);
        let str = "", blank = false, size = 0;
        if (type === FPDF_PAGEOBJ_TEXT) {
          const len = P.FPDFTextObj_GetText(o, text, 0, 0);
          if (len > 2) { const buf = malloc(len); P.FPDFTextObj_GetText(o, text, buf, len); str = M().UTF16ToString(buf); free(buf); }
          blank = !str.trim() || P.FPDFTextObj_GetTextRenderMode(o) === 3;
          const fs = readFloats(1, (p) => P.FPDFTextObj_GetFontSize(o, p))?.[0] || 0, m = readFloats(6, (p) => P.FPDFPageObj_GetMatrix(o, p));
          size = fs * (m ? Math.hypot(m[2], m[3]) || 1 : 1);
        }
        const id = i + ":" + k; // ids carry the real page index; the plan works with indexes from "from"
        handles.set(id, { o, page: i });
        objs.push({ id, l: b[0], b: b[1], r: b[2], t: b[3], kind: type === FPDF_PAGEOBJ_TEXT ? "text" : type === 2 ? "path" : "image", text: str, blank, size });
      }
      pagesOut.push({ width: P.FPDF_GetPageWidthF(page), height: P.FPDF_GetPageHeightF(page), objs });
    }
    return { pages: pagesOut, handles };
  }

  /** Empty spaces on page i, judged against the pages around it. */
  function gapsOf(i) {
    if (gapCache.has(i)) return gapCache.get(i);
    let list = [];
    try {
      const n = P.FPDF_GetPageCount(doc), lo = Math.max(0, i - 4), hi = Math.min(n - 1, i + 4);
      list = findGaps(layoutOf(lo, hi).pages, i - lo);
    } catch (e) { console.warn(e); }
    gapCache.set(i, list);
    return list;
  }

  async function closeGap(gap = lastGap) {
    const g = gap;
    if (!g) return;
    lastGap = null;
    snapshot();
    const { pages: layout, handles } = layoutOf();
    const plan = planGap(layout, g);
    if (!plan.ok) { undo.pop(); ui.undo.disabled = !undo.length; toast(t(g.boxes ? "editGapNone" : "editGapNothing"), 4000); redrawAll(); return; }
    const touched = new Set([g.page]);
    for (const id of plan.drop) {
      const h = handles.get(id);
      if (h && P.FPDFPage_RemoveObject(getPage(h.page).page, h.o)) { P.FPDFPageObj_Destroy(h.o); touched.add(h.page); }
    }
    for (const [id, m] of plan.moves) {
      const h = handles.get(id);
      if (!h) continue;
      if (m.page !== h.page) {
        if (!P.FPDFPage_RemoveObject(getPage(h.page).page, h.o)) continue;
        P.FPDFPage_InsertObject(getPage(m.page).page, h.o);
      }
      if (Math.abs(m.dy) > 0.001) {
        P.FPDFPageObj_Transform(h.o, 1, 0, 0, 1, 0, m.dy);
        // the clipping area goes with it, or the moved content could be cut off
        P.FPDFPageObj_TransformClipPath(h.o, 1, 0, 0, 1, 0, m.dy);
      }
      touched.add(h.page); touched.add(m.page);
    }
    for (const i of touched) P.FPDFPage_GenerateContent(getPage(i).page);
    gapCache.clear();
    const removed = plan.removePages.length;
    if (removed || [...touched].some((i) => i !== g.page)) {
      // content moved between pages (or pages went): the viewer shows the edited document itself
      for (const i of plan.removePages) {
        const p = pages.get(i);
        if (p) { if (p.text) P.FPDFText_ClosePage(p.text); if (form) P.FORM_OnBeforeClosePage(p.page, form); P.FPDF_ClosePage(p.page); pages.delete(i); }
        P.FPDFPage_Delete(doc, i);
      }
      const out = save();
      close();
      await open(out);
      modified.clear(); clearSelection(); pagesChanged = true;
      await reload(out);
    } else {
      changed(g.page);
    }
    onChange?.();
    toast(removed === 1 ? t("editGapClosedPage") : removed ? t("editGapClosedPages", { n: removed }) : t("editGapClosed"), 4000);
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

  function transform(i, item, m) { transformMany(i, [item], m); }
  function transformMany(i, items, m) {
    if (!items.length) return;
    const keep = selected;
    snapshot();
    for (const it of items) P.FPDFPageObj_Transform(it.obj, ...m);
    changed(i);
    selected = keep; // the objects keep their indexes
    decorate(i);
  }

  /* ---------------------------------------------------------- opening up space */
  const spotCache = new Map(); // page → { at: [PDF heights between rows], line }
  let spaceDragging = false;
  function spotsOf(i) {
    if (!spotCache.has(i)) {
      let v = { at: [], line: 14 };
      try { const n = P.FPDF_GetPageCount(doc), lo = Math.max(0, i - 4), hi = Math.min(n - 1, i + 4); v = insertPoints(layoutOf(lo, hi).pages, i - lo); } catch (e) { console.warn(e); }
      spotCache.set(i, v);
    }
    return spotCache.get(i);
  }
  /** The row boundary nearest to the pointer, in layer pixels and PDF points. */
  function nearestSpot(layer, i, e) {
    const pv = pageView(i), rect = layer.getBoundingClientRect(), y = e.clientY - rect.top;
    const { at, line } = spotsOf(i);
    let best = null;
    for (const a of at) {
      const [, py] = pv.viewport.convertToViewportPoint(0, a);
      if (!best || Math.abs(py - y) < Math.abs(best.py - y)) best = { py, at: a };
    }
    return best && Math.abs(best.py - y) < 60 ? { ...best, line } : null;
  }
  function guide(layer) {
    let g = layer.querySelector(".einsert");
    if (!g) { g = document.createElement("div"); g.className = "einsert"; g.innerHTML = `<i></i><span></span>`; layer.append(g); }
    return g;
  }
  function showSpot(layer, i, e) {
    const s = nearestSpot(layer, i, e);
    if (!s) { layer.querySelector(".einsert")?.remove(); return; }
    const g = guide(layer);
    g.style.top = s.py + "px"; g.style.height = "0px";
    g.querySelector("span").textContent = t("editSpaceHere");
  }
  function dragSpace(layer, i, e) {
    const s = nearestSpot(layer, i, e);
    if (!s) { toast(t("editSpaceNoSpot")); return; }
    const pv = pageView(i), scale = pv.viewport.scale, y0 = e.clientY;
    const g = guide(layer);
    spaceDragging = true;
    layer.setPointerCapture(e.pointerId);
    const amount = (ev) => Math.max(0, (ev.clientY - y0) / scale);
    const move = (ev) => {
      const h = amount(ev);
      g.style.top = s.py + "px"; g.style.height = h * scale + "px";
      g.querySelector("span").textContent = h * scale < 4 ? t("editSpaceHere") : t("editSpaceAmount", { n: Math.round(h) });
    };
    const up = async (ev) => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      spaceDragging = false;
      g.remove();
      if (ev.type === "pointercancel") return;
      let h = amount(ev);
      if (h * scale < 4) h = s.line; // a click opens one empty line
      setMode("select");
      await insertSpace(i, s.at, h);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }
  async function insertSpace(i, at, height) {
    snapshot();
    const { pages: layout, handles } = layoutOf();
    const plan = planInsert(layout, { page: i, at, height });
    if (!plan.ok) { undo.pop(); ui.undo.disabled = !undo.length; toast(t("editSpaceNoSpot")); return; }
    const n = P.FPDF_GetPageCount(doc);
    for (const [k, np] of plan.newPages.entries()) { const pg = P.FPDFPage_New(doc, n + k, np.width, np.height); if (pg) P.FPDF_ClosePage(pg); }
    const touched = new Set([i]);
    for (const [id, m] of plan.moves) {
      const h = handles.get(id);
      if (!h) continue;
      if (m.page !== h.page) {
        if (!P.FPDFPage_RemoveObject(getPage(h.page).page, h.o)) continue;
        P.FPDFPage_InsertObject(getPage(m.page).page, h.o);
      }
      if (Math.abs(m.dy) > 0.001) { P.FPDFPageObj_Transform(h.o, 1, 0, 0, 1, 0, m.dy); P.FPDFPageObj_TransformClipPath(h.o, 1, 0, 0, 1, 0, m.dy); }
      touched.add(h.page); touched.add(m.page);
    }
    for (const p of touched) P.FPDFPage_GenerateContent(getPage(p).page);
    gapCache.clear();
    if (plan.newPages.length || [...touched].some((p) => p !== i)) {
      const out = save();
      close();
      await open(out);
      modified.clear(); clearSelection(); pagesChanged = true;
      await reload(out);
    } else changed(i);
    onChange?.();
    toast(plan.newPages.length ? t("editSpaceAddedPages", { n: plan.newPages.length }) : t("editSpaceAdded"), 4000);
    redrawAll();
  }

  /** Draws the chosen shape by dragging; Shift keeps lines straight (every 45°) and makes squares/circles. */
  function drawShape(layer, i, e) {
    const pv = pageView(i), rect = layer.getBoundingClientRect();
    const x0 = e.clientX - rect.left, y0 = e.clientY - rect.top;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "eshape-preview");
    const color = ui.color.value, w = Math.max(1, (+ui.stroke.value || 1) * pv.viewport.scale);
    layer.append(svg);
    layer.setPointerCapture(e.pointerId);
    const end = (ev) => {
      let x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
      if (ev.shiftKey) {
        const dx = x1 - x0, dy = y1 - y0;
        if (shapeKind === "line" || shapeKind === "arrow") {
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          x1 = x0 + Math.cos(a) * len; y1 = y0 + Math.sin(a) * len;
        } else { const d = Math.max(Math.abs(dx), Math.abs(dy)); x1 = x0 + Math.sign(dx || 1) * d; y1 = y0 + Math.sign(dy || 1) * d; }
      }
      return [x1, y1];
    };
    const draw = ([x1, y1]) => {
      const l = Math.min(x0, x1), tp = Math.min(y0, y1), wd = Math.abs(x1 - x0), ht = Math.abs(y1 - y0);
      const st = `stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
      let inner = "";
      if (shapeKind === "line") inner = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" ${st}/>`;
      else if (shapeKind === "arrow") { const [p, q] = arrowWings(x0, y0, x1, y1, w); inner = `<path d="M${x0} ${y0}L${x1} ${y1}M${p[0]} ${p[1]}L${x1} ${y1}L${q[0]} ${q[1]}" fill="none" ${st}/>`; }
      else if (shapeKind === "rect") inner = `<rect x="${l}" y="${tp}" width="${wd}" height="${ht}" fill="none" ${st}/>`;
      else if (shapeKind === "fill") inner = `<rect x="${l}" y="${tp}" width="${wd}" height="${ht}" fill="${color}"/>`;
      else inner = `<ellipse cx="${l + wd / 2}" cy="${tp + ht / 2}" rx="${wd / 2}" ry="${ht / 2}" fill="none" ${st}/>`;
      svg.innerHTML = inner;
    };
    const move = (ev) => draw(end(ev));
    const up = (ev) => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      svg.remove();
      const [x1, y1] = end(ev);
      setMode("select");
      if (Math.hypot(x1 - x0, y1 - y0) < 4) return;
      const a = pv.viewport.convertToPdfPoint(x0, y0), b = pv.viewport.convertToPdfPoint(x1, y1);
      addShape(i, shapeKind, a, b);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }
  /** The two ends of an arrow head at (x1, y1), coming from (x0, y0). */
  function arrowWings(x0, y0, x1, y1, w) {
    const a = Math.atan2(y1 - y0, x1 - x0), len = Math.min(Math.hypot(x1 - x0, y1 - y0) * 0.4, 6 + w * 3);
    return [[x1 - len * Math.cos(a - 0.45), y1 - len * Math.sin(a - 0.45)], [x1 - len * Math.cos(a + 0.45), y1 - len * Math.sin(a + 0.45)]];
  }
  function addShape(i, kind, [ax, ay], [bx, by]) {
    const { page } = getPage(i);
    const [r, g, b] = hexToRgb(ui.color.value), w = +ui.stroke.value || 1;
    snapshot();
    let obj;
    const l = Math.min(ax, bx), bt = Math.min(ay, by), wd = Math.abs(bx - ax), ht = Math.abs(by - ay);
    if (kind === "rect" || kind === "fill") obj = P.FPDFPageObj_CreateNewRect(l, bt, wd, ht);
    else if (kind === "ellipse") {
      const cx = l + wd / 2, cy = bt + ht / 2, rx = wd / 2, ry = ht / 2, k = 0.5523;
      obj = P.FPDFPageObj_CreateNewPath(cx + rx, cy);
      P.FPDFPath_BezierTo(obj, cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
      P.FPDFPath_BezierTo(obj, cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
      P.FPDFPath_BezierTo(obj, cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
      P.FPDFPath_BezierTo(obj, cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
      P.FPDFPath_Close(obj);
    } else {
      obj = P.FPDFPageObj_CreateNewPath(ax, ay);
      P.FPDFPath_LineTo(obj, bx, by);
      if (kind === "arrow") {
        const [p, q] = arrowWings(ax, ay, bx, by, w);
        P.FPDFPath_MoveTo(obj, p[0], p[1]); P.FPDFPath_LineTo(obj, bx, by); P.FPDFPath_LineTo(obj, q[0], q[1]);
      }
    }
    if (kind === "fill") { P.FPDFPageObj_SetFillColor(obj, r, g, b, 255); P.FPDFPath_SetDrawMode(obj, 1, 0); }
    else {
      P.FPDFPageObj_SetStrokeColor(obj, r, g, b, 255);
      P.FPDFPageObj_SetStrokeWidth(obj, w);
      P.FPDFPageObj_SetLineCap(obj, 1); P.FPDFPageObj_SetLineJoin(obj, 1);
      P.FPDFPath_SetDrawMode(obj, 0, 1);
    }
    P.FPDFPage_InsertObject(page, obj);
    changed(i);
    selectNewest(i, FPDF_PAGEOBJ_PATH);
  }

  /** Dragging on an empty spot draws a rectangle; everything it touches is selected. */
  function marquee(layer, i, e, add) {
    const rect = layer.getBoundingClientRect();
    const x0 = e.clientX - rect.left, y0 = e.clientY - rect.top;
    const box = document.createElement("div");
    box.className = "emarquee";
    let shown = false;
    layer.setPointerCapture(e.pointerId);
    const area = (ev) => {
      const x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
      return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    };
    const move = (ev) => {
      const a = area(ev);
      if (!shown && a.width + a.height < 4) return;
      if (!shown) { layer.append(box); shown = true; }
      Object.assign(box.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
    };
    const up = (ev) => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      box.remove();
      if (!shown) { if (!add) select(null, null); return; }
      const a = area(ev), pv = pageView(i);
      const hit = objects(i).filter((it) => {
        const r = screenRect(pv, it.bounds);
        return r.left < a.left + a.width && r.left + r.width > a.left && r.top < a.top + a.height && r.top + r.height > a.top;
      }).map((it) => it.k);
      if (!hit.length && !add) {
        // dragged over empty space: offer to close it
        const [, ya] = pv.viewport.convertToPdfPoint(0, a.top), [, yb] = pv.viewport.convertToPdfPoint(0, a.top + a.height);
        selected = null;
        lastGap = { page: i, at: (ya + yb) / 2, top: Math.max(ya, yb), bottom: Math.min(ya, yb) };
        decorate(i); updateToolbar();
        return;
      }
      if (hit.length || !add) selectMany(i, hit, add);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
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

  function gapOffer(pv, i, { gap, top, bottom, auto }) {
    const W = pv.div.clientWidth;
    const [, yTop] = pv.viewport.convertToViewportPoint(0, top), [, yBot] = pv.viewport.convertToViewportPoint(0, bottom);
    const y0 = Math.min(yTop, yBot), y1 = Math.max(yTop, yBot);
    // room to the right of the page, inside the viewer
    const cont = (viewer.container || pv.div.parentElement).getBoundingClientRect(), pr = pv.div.getBoundingClientRect();
    const room = cont.right - pr.right - 18;
    const wrap = document.createElement("div");
    wrap.className = "egap-wrap" + (room >= 190 ? "" : room >= 70 ? " compact" : " inside");
    wrap.style.top = (y0 + y1) / 2 + "px";
    if (room >= 70) wrap.style.left = W + 10 + "px"; else wrap.style.right = "6px";
    const band = document.createElement("div");
    band.className = "egap-band";
    Object.assign(band.style, { top: y0 + "px", height: Math.max(2, y1 - y0) + "px" });
    const go = document.createElement("button");
    go.className = "egap";
    go.innerHTML = `${icon("arrow-up", 15)}<span></span>`;
    go.querySelector("span").textContent = t("editCloseGap");
    go.title = t("editCloseGapHint");
    go.onclick = (e) => { e.stopPropagation(); closeGap(gap); };
    const x = document.createElement("button");
    x.className = "egap-x";
    x.innerHTML = icon("x", 13);
    x.title = t("editGapHide");
    x.onclick = (e) => {
      e.stopPropagation();
      if (auto) hidden.add(i + ":" + Math.round(gap.at)); else lastGap = null;
      decorate(i);
    };
    wrap.append(go, x);
    wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
    wrap.addEventListener("mouseenter", () => wrap.after(band));
    wrap.addEventListener("mouseleave", () => band.remove());
    return wrap;
  }

  function decorate(i) {
    if (!active) return;
    const pv = pageView(i);
    if (!pv?.div || !pv.viewport) return;
    let layer = pv.div.querySelector(":scope > .edit-layer");
    if (!layer) { layer = document.createElement("div"); layer.className = "edit-layer"; pv.div.append(layer); bindLayer(layer); }
    layer.dataset.page = i;
    layer.replaceChildren();
    layer.classList.toggle("adding", mode === "addText" || mode === "placeImage" || mode === "drawShape");
    layer.classList.toggle("drawing", mode === "drawShape");
    layer.classList.toggle("spacing", mode === "insertSpace");
    if (modified.has(i)) renderPreview(i, pv, layer);
    // "close the gap" offers, beside the page so they never cover the text
    const offers = [];
    if (lastGap && lastGap.page === i) {
      if (lastGap.boxes) {
        const bx = lastGap.boxes;
        offers.push({ gap: lastGap, top: Math.max(...bx.map((q) => q.t)), bottom: Math.min(...bx.map((q) => q.b)) });
      } else offers.push({ gap: lastGap, top: lastGap.top, bottom: lastGap.bottom });
    }
    for (const g of gapsOf(i)) {
      if (hidden.has(i + ":" + Math.round(g.at))) continue;
      if (offers.some((o) => g.at <= o.top + 2 && g.at >= o.bottom - 2)) continue;
      offers.push({ gap: { page: i, at: g.at }, top: g.top, bottom: g.bottom, auto: true });
    }
    for (const o of offers) layer.append(gapOffer(pv, i, o));
    const del = document.createElement("button");
    del.className = "epage-del";
    del.innerHTML = `${icon("trash-2", 15)}<span></span>`;
    del.querySelector("span").textContent = t("editDeletePage");
    del.title = t("editDeletePageN", { n: i + 1 });
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.onclick = (e) => { e.stopPropagation(); deletePage(i); };
    layer.append(del);
    // shapes first, so text and pictures on top of them stay easy to click
    const items = objects(i).sort((a, b) => (a.type === FPDF_PAGEOBJ_PATH ? 0 : 1) - (b.type === FPDF_PAGEOBJ_PATH ? 0 : 1));
    for (const item of items) {
      const r = screenRect(pv, item.bounds);
      const box = document.createElement("div");
      box.className = "eobj " + (item.type === FPDF_PAGEOBJ_TEXT ? "etext" : item.type === FPDF_PAGEOBJ_PATH ? "eshape" : "eimage");
      // thin lines get a box big enough to click
      const padX = Math.max(2, (8 - r.width) / 2), padY = Math.max(2, (8 - r.height) / 2);
      Object.assign(box.style, { left: r.left - padX + "px", top: r.top - padY + "px", width: r.width + 2 * padX + "px", height: r.height + 2 * padY + "px" });
      box.dataset.k = item.k;
      if (selected && selected.page === i && selected.ks.has(item.k)) {
        box.classList.add("sel");
        if (item.type !== FPDF_PAGEOBJ_TEXT && selected.ks.size === 1) { const h = document.createElement("span"); h.className = "handle"; box.append(h); }
      }
      box.title = item.type === FPDF_PAGEOBJ_TEXT ? t("editHintText") : item.type === FPDF_PAGEOBJ_PATH ? t("editHintShape") : t("editHintImage");
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
  /** The selected object when exactly one is selected (editing, styling, replacing). */
  function selectedItem() { return selected?.ks.size === 1 ? itemAt(selected.page, [...selected.ks][0]) : null; }
  function selectedItems() { if (!selected) return []; const all = objects(selected.page); return all.filter((o) => selected.ks.has(o.k)); }
  /** Selects one object; with add, the object is added to (or taken out of) the selection on that page. */
  function select(i, k, add = false) {
    const prev = selected?.page;
    if (k == null) selected = null;
    else if (add && selected && selected.page === i) {
      const ks = new Set(selected.ks);
      ks.has(k) ? ks.delete(k) : ks.add(k);
      selected = ks.size ? { page: i, ks } : null;
    } else selected = { page: i, ks: new Set([k]) };
    if (prev != null && prev !== i) decorate(prev);
    if (i != null) decorate(i);
    updateToolbar();
  }
  function selectMany(i, ks, add = false) {
    const prev = selected?.page;
    const set = new Set(add && selected?.page === i ? selected.ks : []);
    for (const k of ks) set.add(k);
    selected = set.size ? { page: i, ks: set } : null;
    if (prev != null && prev !== i) decorate(prev);
    decorate(i);
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
      if (mode === "drawShape") { e.preventDefault(); drawShape(layer, i, e); return; }
      if (mode === "insertSpace") { e.preventDefault(); dragSpace(layer, i, e); return; }
      if (mode === "addText") {
        e.preventDefault();
        const [x, y] = pv.viewport.convertToPdfPoint(px, py);
        setMode("select");
        openInlineEditor(layer, { left: px, top: py, width: 0, height: 0 }, "", defaultStyle(), (value, style) => value.trim() && addText(i, x, y, value, style).then(() => selectNewest(i, FPDF_PAGEOBJ_TEXT)));
        return;
      }
      const box = e.target.closest(".eobj");
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!box) { e.preventDefault(); marquee(layer, i, e, add); return; }
      e.preventDefault();
      const k = +box.dataset.k;
      if (add) { select(i, k, true); return; }
      if (!selected || selected.page !== i || !selected.ks.has(k)) select(i, k);
      const item = itemAt(i, k);
      if (!item) return;
      const group = selected.ks.size > 1;
      const target = layer.querySelector(`.eobj[data-k="${k}"]`);
      const targets = group ? [...layer.querySelectorAll(".eobj.sel")] : [target];
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
        } else for (const el of targets) el.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const up = (ev) => {
        layer.removeEventListener("pointermove", move);
        layer.removeEventListener("pointerup", up);
        layer.removeEventListener("pointercancel", up);
        if (!moved) return;
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        const vp = pv.viewport;
        if (resizing && !group) {
          const s = Math.max(0.05, Math.max((w0 + dx) / w0, (h0 + dy) / h0));
          const r = screenRect(pv, item.bounds);
          const [ax, ay] = vp.convertToPdfPoint(r.left, r.top);
          transform(i, item, [s, 0, 0, s, ax * (1 - s), ay * (1 - s)]);
        } else {
          const [x0, y0] = vp.convertToPdfPoint(0, 0), [x1, y1] = vp.convertToPdfPoint(dx, dy);
          transformMany(i, group ? selectedItems() : [item], [1, 0, 0, 1, x1 - x0, y1 - y0]);
        }
      };
      layer.addEventListener("pointermove", move);
      layer.addEventListener("pointerup", up);
      layer.addEventListener("pointercancel", up);
    });
    layer.addEventListener("pointermove", (e) => { if (mode === "insertSpace" && !spaceDragging) showSpot(layer, +layer.dataset.page, e); });
    layer.addEventListener("pointerleave", () => { if (!spaceDragging) layer.querySelector(".einsert")?.remove(); });
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
      <span class="shape-pick">
        <button class="btn sm secondary" data-e="shape" aria-haspopup="menu" aria-expanded="false">${icon("shapes", 16)}<span>${t("editShape")}</span>${icon("chevron-down", 14)}</button>
        <div class="shape-menu" role="menu" data-e="shapeMenu" hidden>
          ${SHAPES.map((k) => `<button role="menuitem" data-shape="${k}">${icon("shape-" + k, 18)}<span>${t("editShape_" + k)}</span></button>`).join("")}
        </div>
      </span>
      <button class="btn sm secondary" data-e="space" title="${t("editSpaceHint")}">${icon("unfold-vertical", 16)}<span>${t("editSpace")}</span></button>
      <div class="sep"></div>
      <select class="field sm" data-e="family"><option value="sans">Sans</option><option value="serif">Serif</option></select>
      <input class="field num sm" data-e="size" type="number" min="4" max="200" step="1" value="12" title="${t("fontSize")}">
      <button class="btn icon sm" data-e="bold" aria-pressed="false" title="Bold"><b>B</b></button>
      <button class="btn icon sm" data-e="italic" aria-pressed="false" title="Italic"><i style="font-family:serif">I</i></button>
      <input type="color" class="colorpick" data-e="color" value="#000000" title="${t("color")}">
      <select class="field sm" data-e="stroke" title="${t("editStroke")}">${[0.5, 1, 1.5, 2, 3, 5, 8].map((w) => `<option value="${w}"${w === 2 ? " selected" : ""}>${String(w).replace(".", ",")} pt</option>`).join("")}</select>
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
    const els = Object.fromEntries(["addText", "addImage", "addSig", "shape", "shapeMenu", "space", "stroke", "family", "size", "bold", "italic", "color", "replace", "delete", "delPage", "undo", "hint", "cancel", "done", "file"].map((n) => [n, q(n)]));
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
    els.family.onchange = els.size.onchange = els.color.onchange = els.stroke.onchange = () => restyleSelected();
    els.space.onclick = () => setMode(mode === "insertSpace" ? "select" : "insertSpace");
    const menu = (open) => { els.shapeMenu.hidden = !open; els.shape.setAttribute("aria-expanded", open); };
    els.shape.onclick = (e) => { e.stopPropagation(); menu(els.shapeMenu.hidden); };
    els.shapeMenu.onclick = (e) => {
      const b = e.target.closest("[data-shape]");
      if (!b) return;
      menu(false);
      shapeKind = b.dataset.shape;
      setMode("drawShape");
    };
    addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".shape-pick")) menu(false); }, true);
    return els;
  }

  function updateToolbar() {
    const it = selectedItem(), many = selected?.ks.size > 1;
    const isText = it?.type === FPDF_PAGEOBJ_TEXT, isImg = it?.type === FPDF_PAGEOBJ_IMAGE;
    ui.replace.hidden = !isImg;
    ui.delete.disabled = !selected;
    ui.undo.disabled = !undo.length;
    ui.addText.classList.toggle("on", mode === "addText");
    const isShape = it?.type === FPDF_PAGEOBJ_PATH;
    ui.hint.textContent = mode === "insertSpace" ? t("editHintSpace") : mode === "drawShape" ? t("editHintDraw") : mode === "placeImage" ? t("editHintPlace") : mode === "addText" ? t("editHintAdd") : many ? t("editHintMany", { n: selected.ks.size }) : isText ? t("editHintText") : isImg ? t("editHintImage") : isShape ? t("editHintShape") : t("editHint");
    ui.hint.title = ui.hint.textContent;
    if (isShape) {
      ui.color.value = it.color;
      if (it.stroked) ui.stroke.value = [...ui.stroke.options].reduce((a, o) => (Math.abs(+o.value - it.width) < Math.abs(+a - it.width) ? o.value : a), "2");
    }
    if (isText) {
      ui.family.value = it.serif ? "serif" : "sans";
      ui.size.value = Math.round(it.size * it.scale * 10) / 10;
      ui.bold.setAttribute("aria-pressed", it.bold);
      ui.italic.setAttribute("aria-pressed", it.italic);
      ui.color.value = it.color;
    }
  }

  async function restyleSelected() {
    const shapes = selectedItems().filter((o) => o.type === FPDF_PAGEOBJ_PATH);
    if (shapes.length && shapes.length === selected.ks.size) {
      const [r, g, b] = hexToRgb(ui.color.value), w = +ui.stroke.value || 1, keep = selected;
      snapshot();
      for (const o of shapes) {
        if (o.stroked) { P.FPDFPageObj_SetStrokeColor(o.obj, r, g, b, 255); P.FPDFPageObj_SetStrokeWidth(o.obj, w); }
        if (o.filled) P.FPDFPageObj_SetFillColor(o.obj, r, g, b, 255);
      }
      changed(keep.page);
      selected = keep; decorate(keep.page); updateToolbar();
      return;
    }
    const it = selectedItem();
    if (it?.type !== FPDF_PAGEOBJ_TEXT) return;
    const style = defaultStyle();
    style.size = style.size / it.scale; // size in text space
    const page = selected.page; // setText clears the selection
    await setText(page, it, it.text, style);
    selectNewest(page, FPDF_PAGEOBJ_TEXT);
  }

  function deleteSelected() {
    const items = selectedItems();
    if (!items.length) return;
    const i = selected.page;
    const prevGap = lastGap;
    snapshot();
    // several deletions in a row on one page make one gap
    const boxes = items.filter((it) => it.type !== FPDF_PAGEOBJ_PATH).map((it) => ({ l: it.bounds[0], b: it.bounds[1], r: it.bounds[2], t: it.bounds[3] }));
    // (deleting just a line or a shape leaves no gap worth closing)
    const merged = prevGap?.boxes && prevGap.page === i ? [...prevGap.boxes, ...boxes] : boxes;
    lastGap = merged.length ? { page: i, boxes: merged } : null;
    for (const it of items) removeObject(getPage(i).page, it.obj);
    selected = null;
    changed(i);
    updateToolbar();
  }

  function setMode(m) {
    mode = m;
    if (m === "addText" || m === "drawShape" || m === "insertSpace") select(null, null);
    if (m !== "placeImage") pending = null;
    for (const l of document.querySelectorAll(".edit-layer")) l.classList.toggle("adding", m === "addText" || m === "placeImage" || m === "drawShape");
    ui.shape.classList.toggle("on", m === "drawShape");
    ui.space.classList.toggle("on", m === "insertSpace");
    spotCache.clear();
    for (const l of document.querySelectorAll(".edit-layer")) { l.classList.toggle("spacing", m === "insertSpace"); l.querySelector(".einsert")?.remove(); }
    for (const l of document.querySelectorAll(".edit-layer")) l.classList.toggle("drawing", m === "drawShape");
    updateToolbar();
  }

  function nudge(dx, dy) {
    const items = selectedItems();
    if (!items.length) return;
    const pv = pageView(selected.page), vp = pv.viewport;
    const [x0, y0] = vp.convertToPdfPoint(0, 0), [x1, y1] = vp.convertToPdfPoint(dx * vp.scale, dy * vp.scale);
    transformMany(selected.page, items, [1, 0, 0, 1, x1 - x0, y1 - y0]);
  }

  function onKey(e) {
    if (!active || e.target.closest?.("input, select, .inline-edit, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    // by key position, so the shortcuts also work with the Greek keyboard layout
    const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    if (mod && letter === "z") { e.preventDefault(); e.stopPropagation(); doUndo(); return; }
    if (mod && letter === "a") {
      e.preventDefault(); e.stopPropagation();
      const i = selected?.page ?? viewer.currentPageNumber - 1;
      selectMany(i, objects(i).map((o) => o.k));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selected) { e.preventDefault(); e.stopPropagation(); deleteSelected(); if (e.shiftKey) closeGap(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (mode !== "select") setMode("select"); else if (selected) select(null, null); return; }
    if (e.key === "Enter" && selectedItem()) { e.preventDefault(); e.stopPropagation(); editText(selected.page, [...selected.ks][0]); return; }
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && selected) { e.preventDefault(); e.stopPropagation(); nudge(...arrows[e.key]); }
  }

  const onRendered = ({ pageNumber }) => decorate(pageNumber - 1);

  /* ---------------------------------------------------------- session */
  async function enter(bytes, pw = "") {
    password = pw || "";
    originalBytes = bytes.slice(); pagesChanged = false; lastGap = null; gapCache.clear(); hidden.clear();
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
