// Flipleaf Pro tools: organize, convert, forms, security, comments.
// Structural changes run in PDFium (pdfium.js); rendering and text extraction use PDF.js.
import "./pro-strings.js";
import { PdfDoc, pdfium, readFloats, malloc, free, M, heap, putBytes, wstr, floats, ints } from "./pdfium.js";
import { hasPro, plan } from "./licensing.js";
import { makeZip, makeDocx } from "./zip.js";

const FONT_URL = new URL("./vendor/fonts/", import.meta.url).href;
const FPDF = { TEXT: 1, IMAGE: 3, ANNOT_TEXT: 1, ANNOT_LINE: 4, ANNOT_SQUARE: 5, ANNOT_CIRCLE: 6, FIELD_CHECK: 2, FIELD_TEXT: 6, FIELD_SIGN: 7 };

export function installPro(app) {
  const { t, toast, icon, dialog, busy, platform, viewer, eventBus, pdfjsLib, LANG } = app;
  const P = () => pdfium();

  /* ============================================================ helpers */

  function gate(feature, fn) {
    return async (...args) => {
      if (!hasPro(feature)) { await dialog({ title: "Flipleaf Pro", body: el("p", t("launchFree")), buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] }); return; }
      if (!app.doc.pdf && !["combine", "imagesToPdf"].includes(feature)) return;
      try { return await fn(...args); }
      catch (e) { console.error(e); toast(t("failed", { err: e?.message || e }), 6000); }
    };
  }
  function el(tag, text, attrs = {}) { const e = document.createElement(tag); if (text != null) e.textContent = text; Object.assign(e, attrs); return e; }
  function html(s) { const d = document.createElement("div"); d.innerHTML = s; return d; }
  const pw = () => app.doc.password || "";
  async function bytesNow() { const b = await app.documentBytes(); return b instanceof Uint8Array ? b.slice() : new Uint8Array(b); }
  const baseName = () => app.doc.name.replace(/\.pdf$/i, "");
  const sizeStr = (b) => b > 1048576 ? (b / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";

  /** Cancel / Apply dialog; resolves to "ok" when confirmed. */
  const ask = (title, body, okLabel = t("apply")) => dialog({ title, body, buttons: [{ label: t("cancel"), value: "cancel" }, { label: okLabel, value: "ok", kind: "primary" }] });
  /** Dialog with the wide layout (All tools, Compare). */
  async function wideDialog(opts) {
    const dlg = document.getElementById("dlg");
    dlg.classList.add("wide");
    await dialog(opts);
    dlg.classList.remove("wide");
  }
  function closeDialog(v) { const d = document.getElementById("dlg"); d.returnValue = v; d.close(v); }
  /** Fills / reads every [data-k] input of a dialog body, keyed by data-k. */
  function fillFields(box, values) { for (const inp of box.querySelectorAll("[data-k]")) inp.value = values[inp.dataset.k]; }
  function readFields(box) { const v = {}; for (const inp of box.querySelectorAll("[data-k]")) v[inp.dataset.k] = inp.value; return v; }

  /** Copies pages `idx` of `src` into `dst` at position `at`. */
  function importPages(dst, src, idx, at) { const p = ints(...idx); P().FPDF_ImportPagesByIndex(dst.h, src.h, p, idx.length, at); free(p); }
  const allIndexes = (n) => [...Array(n).keys()];
  /** New PDF made of pages `idx` of `src`. */
  async function pdfFromPages(src, idx) { const out = await PdfDoc.create(); importPages(out, src, idx, 0); const b = out.save(); out.close(); return b; }
  /** Adds quarter turns (deg: 90/180/270) to page k. */
  function addRotation(doc, k, deg) { const pg = doc.page(k); P().FPDFPage_SetRotation(pg, (P().FPDFPage_GetRotation(pg) + deg / 90) % 4); }

  /** Opens the current document in PDFium, runs fn, and loads the result back into the viewer. */
  async function modify(fn, message = t("working")) {
    const overlay = busy(message);
    try {
      const doc = await PdfDoc.open(await bytesNow(), pw());
      let out;
      try { const r = await fn(doc); if (r === false) return false; out = doc.save(); } finally { doc.close(); }
      await app.replaceDocumentData(out);
      return true;
    } finally { overlay.remove(); }
  }

  function parseRange(text, total) {
    const set = new Set();
    for (const part of String(text || "").split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)?\s*-\s*(\d+)?$/);
      if (m) { const a = +(m[1] || 1), b = +(m[2] || total); for (let i = Math.max(1, a); i <= Math.min(total, b); i++) set.add(i - 1); }
      else if (/^\d+$/.test(part) && +part >= 1 && +part <= total) set.add(+part - 1);
    }
    return [...set].sort((a, b) => a - b);
  }

  /** "Apply to" selector used by several dialogs. */
  function rangePicker() {
    const box = html(`<label class="frow"><span>${t("applyTo")}</span>
      <select class="field" data-r><option value="all">${t("allPages")}</option><option value="cur">${t("currentPage")}</option><option value="range">${t("pageRange")}</option></select>
      <input class="field" data-rv placeholder="1-3, 5" hidden></label>`).firstElementChild;
    const sel = box.querySelector("[data-r]"), inp = box.querySelector("[data-rv]");
    sel.onchange = () => (inp.hidden = sel.value !== "range");
    box.pages = (total) => sel.value === "all" ? [...Array(total).keys()] : sel.value === "cur" ? [viewer.currentPageNumber - 1] : parseRange(inp.value, total);
    return box;
  }

  function pickFiles(accept, multiple) {
    const input = el("input", null, { type: "file", accept, multiple });
    return new Promise((resolve) => {
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve([]);
      input.click();
    });
  }

  /** Saves several files: a folder on desktop, a single .zip in the browser. */
  async function saveMany(files, zipName) {
    if (platform.isDesktop) {
      const dir = await platform.pickFolder();
      if (!dir) return false;
      for (const f of files) await platform.writeInFolder(dir, f.name, f.bytes);
      return dir;
    }
    await platform.saveBytesAs(makeZip(files), zipName + ".zip");
    return true;
  }

  const fontCache = new WeakMap();
  async function font(doc, bold = false) {
    let m = fontCache.get(doc);
    if (!m) fontCache.set(doc, (m = {}));
    const key = bold ? "b" : "r";
    if (!m[key]) {
      const bytes = new Uint8Array(await (await fetch(FONT_URL + (bold ? "FlipleafSans-Bold.ttf" : "FlipleafSans-Regular.ttf"))).arrayBuffer());
      const p = putBytes(bytes);
      m[key] = P().FPDFText_LoadFont(doc.h, p, bytes.length, 2, true);
      free(p);
    }
    return m[key];
  }

  /** Maps upright ("visual") page coordinates to PDF user space, honouring /Rotate and the media box. */
  function pageFrame(doc, i) {
    const pg = doc.page(i), rot = P().FPDFPage_GetRotation(pg);
    const [l, b, r, tp] = doc.mediaBox(i) || [0, 0, ...doc.size(i)];
    const w = r - l, h = tp - b;
    const W = rot % 2 ? h : w, H = rot % 2 ? w : h;
    const toUser = (vx, vy) => [[vx, vy], [w - vy, vx], [w - vx, h - vy], [vy, h - vx]][rot].map((v, k) => v + (k ? b : l));
    const dir = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]][rot]; // visual axes in user space
    return { W, H, toUser, dir, rot };
  }

  /** Writes a line of text on a page at an upright position. align: 0 left, 0.5 center, 1 right of x. */
  async function stampText(doc, i, text, { x, y, size = 10, color = [0, 0, 0], opacity = 1, angle = 0, bold = false, align = 0, center = false }) {
    const fr = pageFrame(doc, i), pg = doc.page(i);
    const obj = P().FPDFPageObj_CreateTextObj(doc.h, await font(doc, bold), size);
    const sp = wstr(text); P().FPDFText_SetText(obj, sp); free(sp);
    P().FPDFPageObj_SetFillColor(obj, color[0], color[1], color[2], Math.round(255 * opacity));
    const bx = readFloats(4, (p) => P().FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) || [0, 0, size * text.length * 0.5, size];
    const tw = bx[2] - bx[0];
    // place in visual space: shift for alignment, rotate by angle, then map to user space
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const ox = center ? -tw / 2 : -tw * align, oy = center ? -size * 0.35 : 0;
    const [ux, uy] = fr.toUser(x + ox * c - oy * s, y + ox * s + oy * c);
    const [d0, d1, d2, d3] = fr.dir;
    // text matrix = rotation(angle) composed with the page's visual axes
    const m = [c * d0 + s * d2, c * d1 + s * d3, -s * d0 + c * d2, -s * d1 + c * d3, ux, uy];
    P().FPDFPageObj_Transform(obj, ...m);
    P().FPDFPage_InsertObject(pg, obj);
  }

  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* ============================================================ region / point picker over the pages */

  const pick = (() => {
    let state = null;
    const bar = document.getElementById("pickBar");

    function layerFor(i) {
      const pv = viewer.getPageView(i);
      if (!pv?.div) return null;
      let layer = pv.div.querySelector(":scope > .pick-layer");
      if (!layer) {
        layer = el("div"); layer.className = "pick-layer"; layer.dataset.page = i; pv.div.append(layer);
        layer.addEventListener("pointerdown", (e) => down(e, layer));
      }
      return layer;
    }
    function draw(i) {
      if (!state) return;
      const layer = layerFor(i), pv = viewer.getPageView(i);
      if (!layer) return;
      layer.className = "pick-layer " + state.mode;
      layer.querySelectorAll(".pick-box").forEach((b) => b.remove());
      for (const it of state.items.filter((x) => x.page === i)) {
        const [x1, y1] = pv.viewport.convertToViewportPoint(it.rect[0], it.rect[1]);
        const [x2, y2] = pv.viewport.convertToViewportPoint(it.rect[2], it.rect[3]);
        const b = el("div"); b.className = "pick-box " + (state.boxClass || "");
        Object.assign(b.style, { left: Math.min(x1, x2) + "px", top: Math.min(y1, y2) + "px", width: Math.abs(x2 - x1) + "px", height: Math.abs(y2 - y1) + "px" });
        if (it.label) b.dataset.label = it.label;
        layer.append(b);
      }
    }
    function redrawAll() { for (let i = 0; i < viewer.pagesCount; i++) if (viewer.getPageView(i)?.div?.querySelector("canvas")) draw(i); }
    const onRendered = ({ pageNumber }) => draw(pageNumber - 1);

    function down(e, layer) {
      if (!state || e.button !== 0) return;
      e.preventDefault();
      const i = +layer.dataset.page, pv = viewer.getPageView(i), r = layer.getBoundingClientRect();
      const p0 = [e.clientX - r.left, e.clientY - r.top];
      if (state.mode === "point") {
        const [x, y] = pv.viewport.convertToPdfPoint(...p0);
        finish([{ page: i, point: [x, y] }]);
        return;
      }
      const ghost = el("div"); ghost.className = "pick-box drawing " + (state.boxClass || ""); layer.append(ghost);
      layer.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const p1 = [ev.clientX - r.left, ev.clientY - r.top];
        Object.assign(ghost.style, { left: Math.min(p0[0], p1[0]) + "px", top: Math.min(p0[1], p1[1]) + "px", width: Math.abs(p1[0] - p0[0]) + "px", height: Math.abs(p1[1] - p0[1]) + "px" });
      };
      const up = (ev) => {
        layer.removeEventListener("pointermove", move); layer.removeEventListener("pointerup", up);
        ghost.remove();
        const p1 = [ev.clientX - r.left, ev.clientY - r.top];
        if (Math.abs(p1[0] - p0[0]) < 4 && Math.abs(p1[1] - p0[1]) < 4) return;
        const a = pv.viewport.convertToPdfPoint(...p0), b = pv.viewport.convertToPdfPoint(...p1);
        const item = { page: i, start: a, end: b, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
        state.onAdd?.(item);
        state.items.push(item);
        if (state.single) finish(state.items);
        else draw(i);
        updateBar();
      };
      layer.addEventListener("pointermove", move);
      layer.addEventListener("pointerup", up);
    }

    function updateBar() { const c = bar.querySelector("[data-count]"); if (c && state) c.textContent = state.countText ? state.countText(state.items.length) : ""; }

    let resolver = null;
    function finish(result) {
      if (!state) return;
      eventBus.off("pagerendered", onRendered);
      document.querySelectorAll(".pick-layer").forEach((l) => l.remove());
      document.body.classList.remove("picking");
      bar.hidden = true; bar.replaceChildren();
      removeEventListener("keydown", onKey, true);
      state = null;
      const r = resolver; resolver = null;
      r?.(result);
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } }

    /** Shows the picker. Resolves to items (or null when cancelled). */
    function start({ title, hint, mode = "rect", single = false, options = null, boxClass = "", countText = null, onAdd = null, applyLabel = t("apply"), extra = [] }) {
      if (state) finish(null);
      state = { mode, items: [], single, boxClass, countText, onAdd };
      document.body.classList.add("picking");
      bar.hidden = false;
      bar.replaceChildren(el("span", title, { className: "label" }));
      if (options) bar.append(options);
      for (const x of extra) bar.append(x);
      bar.append(el("span", hint, { className: "hint muted" }), el("span", "", { className: "muted small" }));
      bar.lastElementChild.dataset.count = "";
      const sp = el("div"); sp.className = "spacer"; bar.append(sp);
      if (!single && mode !== "point") {
        const undo = el("button", t("undoLast"), { className: "btn sm secondary" });
        undo.onclick = () => { const it = state.items.pop(); if (it) draw(it.page); updateBar(); };
        bar.append(undo);
      }
      const cancel = el("button", t("cancel"), { className: "btn sm secondary" }); cancel.onclick = () => finish(null);
      bar.append(cancel);
      if (!single && mode !== "point") { const ok = el("button", applyLabel, { className: "btn sm primary" }); ok.onclick = () => finish(state.items); bar.append(ok); }
      eventBus.on("pagerendered", onRendered);
      addEventListener("keydown", onKey, true);
      redrawAll();
      return new Promise((r) => (resolver = r));
    }
    return { start, add(items) { if (!state) return; state.items.push(...items); redrawAll(); updateBar(); }, get active() { return !!state; } };
  })();

  /* ============================================================ EDIT & ORGANIZE */

  const organize = gate("organize", async () => {
    const pdf = app.doc.pdf, files = new Map(); // key → { bytes, pdfjs }
    let entries = [...Array(pdf.numPages).keys()].map((i) => ({ src: 0, index: i, rot: 0 }));
    let selected = new Set(), lastClicked = null, nextKey = 1;
    const view = html(`<div class="organizer" role="dialog">
      <header><b>${t("organize")}</b>
        <button class="btn sm secondary" data-a="rotL">${icon("rotate-ccw", 16)}<span>${t("orgRotL")}</span></button>
        <button class="btn sm secondary" data-a="rotR">${icon("rotate-cw", 16)}<span>${t("orgRotR")}</span></button>
        <button class="btn sm secondary" data-a="del">${icon("trash-2", 16)}<span>${t("orgDelete")}</span></button>
        <button class="btn sm secondary" data-a="blank">${icon("file", 16)}<span>${t("orgBlank")}</span></button>
        <button class="btn sm secondary" data-a="insert">${icon("plus", 16)}<span>${t("orgInsert")}</span></button>
        <button class="btn sm secondary" data-a="extract">${icon("download", 16)}<span>${t("orgExtract")}</span></button>
        <button class="btn sm secondary" data-a="split">${icon("columns-2", 16)}<span>${t("orgSplit")}</span></button>
        <span class="muted small" data-sel></span><div class="spacer"></div>
        <button class="btn sm secondary" data-a="cancel">${t("cancel")}</button>
        <button class="btn sm primary" data-a="apply">${t("orgApply")}</button></header>
      <p class="muted small hint">${t("orgHint")}</p>
      <div class="org-grid"></div></div>`).firstElementChild;
    document.body.append(view);
    const grid = view.querySelector(".org-grid");
    const thumbCache = new Map();
    const io = new IntersectionObserver((list) => { for (const e of list) if (e.isIntersecting) renderThumb(e.target); }, { root: grid, rootMargin: "300px" });

    async function sourceDoc(src) { return src === 0 ? pdf : files.get(src).pdfjs; }
    async function renderThumb(card) {
      const e = entries[+card.dataset.i];
      if (!e || card.dataset.done === `${e.src}:${e.index}`) return;
      card.dataset.done = `${e.src}:${e.index}`;
      const box = card.querySelector(".othumb");
      if (e.blank) { box.replaceChildren(); return; }
      const key = `${e.src}:${e.index}`;
      let url = thumbCache.get(key);
      if (!url) {
        const d = await sourceDoc(e.src), page = await d.getPage(e.index + 1);
        const vp0 = page.getViewport({ scale: 1 }), scale = 300 / Math.max(vp0.width, vp0.height);
        const vp = page.getViewport({ scale });
        const c = el("canvas"); c.width = vp.width; c.height = vp.height;
        await page.render({ canvas: c, viewport: vp }).promise;
        url = c.toDataURL("image/jpeg", 0.8); thumbCache.set(key, url);
      }
      const img = el("img"); img.src = url; img.draggable = false;
      box.replaceChildren(img);
    }

    function render() {
      io.disconnect();
      grid.replaceChildren(...entries.map((e, i) => {
        const card = html(`<div class="ocard" draggable="true"><div class="othumb"></div><span></span></div>`).firstElementChild;
        card.dataset.i = i;
        card.classList.toggle("sel", selected.has(e));
        card.querySelector("span").textContent = i + 1;
        card.querySelector(".othumb").style.transform = `rotate(${e.rot}deg)`;
        if (e.blank) card.classList.add("blank");
        card.onclick = (ev) => {
          if (ev.shiftKey && lastClicked != null) { const [a, b] = [lastClicked, i].sort((x, y) => x - y); for (let k = a; k <= b; k++) selected.add(entries[k]); }
          else if (ev.ctrlKey || ev.metaKey) { selected.has(e) ? selected.delete(e) : selected.add(e); }
          else { selected = new Set([e]); }
          lastClicked = i; render();
        };
        card.ondragstart = (ev) => { ev.dataTransfer.setData("text/plain", i); card.classList.add("dragging"); };
        card.ondragend = () => card.classList.remove("dragging");
        card.ondragover = (ev) => { ev.preventDefault(); card.classList.add("over"); };
        card.ondragleave = () => card.classList.remove("over");
        card.ondrop = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const from = +ev.dataTransfer.getData("text/plain");
          if (isNaN(from)) return;
          const moving = selected.has(entries[from]) ? entries.filter((x) => selected.has(x)) : [entries[from]];
          const target = entries[i];
          entries = entries.filter((x) => !moving.includes(x));
          let at = entries.indexOf(target); if (at < 0) at = entries.length;
          const r = card.getBoundingClientRect();
          if (ev.clientX > r.left + r.width / 2) at++;
          entries.splice(at, 0, ...moving);
          render();
        };
        io.observe(card);
        return card;
      }));
      view.querySelector("[data-sel]").textContent = selected.size ? t("orgSelected", { n: selected.size }) : "";
    }
    render();

    const close = () => { io.disconnect(); view.remove(); removeEventListener("keydown", key, true); };
    const key = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) { e.preventDefault(); e.stopPropagation(); act("del"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); e.stopPropagation(); selected = new Set(entries); render(); }
    };
    addEventListener("keydown", key, true);
    const sel = () => entries.filter((e) => selected.has(e));

    async function act(a) {
      if (a === "cancel") return close();
      if (a === "rotL" || a === "rotR") { for (const e of sel()) e.rot = (e.rot + (a === "rotR" ? 90 : 270)) % 360; return render(); }
      if (a === "del") {
        if (entries.length - selected.size < 1) return toast(t("orgEmpty"));
        entries = entries.filter((e) => !selected.has(e)); selected.clear(); return render();
      }
      if (a === "blank") {
        const at = Math.max(...sel().map((e) => entries.indexOf(e)), entries.length - 1) + 1;
        entries.splice(at, 0, { blank: true, src: -1, index: 0, rot: 0 }); return render();
      }
      if (a === "insert") {
        const [f] = await pickFiles("application/pdf,.pdf", false);
        if (!f) return;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const pj = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
        const k = nextKey++; files.set(k, { bytes, pdfjs: pj });
        const at = selected.size ? Math.max(...sel().map((e) => entries.indexOf(e))) + 1 : entries.length;
        entries.splice(at, 0, ...[...Array(pj.numPages).keys()].map((i) => ({ src: k, index: i, rot: 0 })));
        return render();
      }
      if (a === "extract") {
        const list = sel().length ? sel() : entries;
        return platform.saveBytesAs(await buildNew(list), `${baseName()}-pages.pdf`);
      }
      if (a === "split") {
        const n = await askNumber(t("split"), t("splitEvery"), t("splitPages"), 1, Math.max(1, Math.ceil(entries.length / 2)));
        if (!n) return;
        const outs = [];
        for (let k = 0; k < entries.length; k += n) outs.push({ name: `${baseName()}-${String(k / n + 1).padStart(2, "0")}.pdf`, bytes: await buildNew(entries.slice(k, k + n)) });
        if (await saveMany(outs, `${baseName()}-split`)) toast(t("splitDone", { n: outs.length }));
        return;
      }
      if (a === "apply") {
        const overlay = busy(t("working"));
        try { await applyInPlace(entries, files); close(); } finally { overlay.remove(); }
      }
    }
    view.querySelector("header").addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) act(b.dataset.a); });

    /** Builds a brand-new PDF from page entries (extract / split). */
    async function buildNew(list) {
      const out = await PdfDoc.create();
      const srcs = new Map();
      try {
        srcs.set(0, await PdfDoc.open(await bytesNow(), pw()));
        for (const [k, f] of files) srcs.set(k, await PdfDoc.open(f.bytes));
        list.forEach((e, at) => {
          if (e.blank) { const [w, h] = out.count ? out.size(0) : [595, 842]; out.releasePages(); P().FPDFPage_New(out.h, at, w, h); return; }
          importPages(out, srcs.get(e.src), [e.index], at);
        });
        out.releasePages();
        list.forEach((e, at) => { if (e.rot) addRotation(out, at, e.rot); });
        return out.save();
      } finally { out.close(); for (const d of srcs.values()) d.close(); }
    }
  });

  /** Reorders/deletes/inserts in the original document itself, so its forms and bookmarks survive. */
  async function applyInPlace(entries, files) {
    await modify(async (doc) => {
      // 1. append inserted pages and blank pages at the end; track where each entry lives
      let count = doc.count;
      const live = allIndexes(count).map((i) => ({ src: 0, index: i })); // live[k] = what is at position k
      for (const e of entries) {
        if (e.src === 0) continue;
        if (e.blank) { const [w, h] = doc.size(0); doc.releasePages(); P().FPDFPage_New(doc.h, count, w, h); }
        else {
          const src = await PdfDoc.open(files.get(e.src).bytes);
          importPages(doc, src, [e.index], count); src.close();
        }
        live.push(e); count++;
      }
      // 2. delete originals that are no longer used (from the end, so indexes stay valid)
      const keep = new Set(entries.filter((e) => e.src === 0).map((e) => e.index));
      doc.releasePages();
      for (let k = live.length - 1; k >= 0; k--) {
        const it = live[k];
        if (it.src === 0 && !keep.has(it.index)) { P().FPDFPage_Delete(doc.h, k); live.splice(k, 1); }
      }
      // 3. move every page into its final position
      const find = (e) => live.findIndex((x) => (e.src === 0 ? x.src === 0 && x.index === e.index : x === e));
      entries.forEach((e, target) => {
        const cur = find(e);
        if (cur !== target) {
          const p = ints(cur); P().FPDF_MovePages(doc.h, p, 1, target); free(p);
          const [x] = live.splice(cur, 1); live.splice(target, 0, x);
        }
      });
      doc.releasePages();
      // 4. rotations
      entries.forEach((e, k) => { if (e.rot) addRotation(doc, k, e.rot); });
    });
  }

  async function askNumber(title, label, suffix, min, value) {
    const box = html(`<label class="frow"><span>${label}</span><input class="field" type="number" min="${min}" value="${value}" style="width:90px"><span>${suffix}</span></label>`);
    const r = await ask(title, box);
    const n = parseInt(box.querySelector("input").value, 10);
    return r === "ok" && n >= min ? n : null;
  }

  const combine = gate("combine", async () => {
    // Files to combine, in order. The open document (if any) starts the list; the user can remove it.
    const items = [];
    const addFiles = async () => {
      for (const f of await pickFiles("application/pdf,.pdf", true)) items.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    if (app.doc.pdf) items.push({ name: app.doc.name, bytes: await bytesNow(), password: pw(), current: true });
    await addFiles();
    if (items.length < 2 && !items.some((x) => !x.current)) return;

    const box = html(`<p class="small muted">${t("combineOrder")}</p><ol class="clist"></ol>
      <button type="button" class="btn sm secondary" data-add>${icon("plus", 16)}<span>${t("combineAdd")}</span></button>`);
    const list = box.querySelector(".clist");
    const move = (from, to) => { const [x] = items.splice(from, 1); items.splice(to, 0, x); render(); };
    let dragFrom = -1;
    function render() {
      list.replaceChildren(...items.map((it, i) => {
        const li = el("li", null, { className: "citem", draggable: true });
        li.innerHTML = `<span class="cnum">${i + 1}</span>${icon("file-text", 16)}<span class="cname"></span>
          <button type="button" class="btn icon sm" data-m="up" title="${t("moveUp")}"${i === 0 ? " disabled" : ""}>${icon("chevron-up", 16)}</button>
          <button type="button" class="btn icon sm" data-m="down" title="${t("moveDown")}"${i === items.length - 1 ? " disabled" : ""}>${icon("chevron-down", 16)}</button>
          <button type="button" class="btn icon sm" data-m="del" title="${t("orgDelete")}">${icon("x", 16)}</button>`;
        li.querySelector(".cname").textContent = it.current ? `${it.name} (${t("combineCurrent")})` : it.name;
        li.querySelector('[data-m="up"]').onclick = () => move(i, i - 1);
        li.querySelector('[data-m="down"]').onclick = () => move(i, i + 1);
        li.querySelector('[data-m="del"]').onclick = () => { items.splice(i, 1); render(); };
        li.ondragstart = (e) => { dragFrom = i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
        li.ondragend = () => li.classList.remove("dragging");
        li.ondragover = (e) => { e.preventDefault(); li.classList.add("over"); };
        li.ondragleave = () => li.classList.remove("over");
        li.ondrop = (e) => { e.preventDefault(); if (dragFrom >= 0 && dragFrom !== i) move(dragFrom, i); dragFrom = -1; };
        return li;
      }));
      const ok = document.querySelector('#dlgFoot button[value="ok"]');
      if (ok) ok.disabled = items.length < 2;
    }
    box.querySelector("[data-add]").onclick = async () => { await addFiles(); render(); };
    const answer = ask(t("combine").replace("…", ""), box, t("combineGo"));
    render();
    if (await answer !== "ok" || items.length < 2) return;

    const overlay = busy(t("working"));
    try {
      const base = await PdfDoc.open(items[0].bytes, items[0].password);
      try {
        for (const it of items.slice(1)) {
          const src = await PdfDoc.open(it.bytes, it.password);
          importPages(base, src, allIndexes(src.count), base.count);
          src.close();
        }
        await app.openData({ name: `${t("combined")}.pdf`, data: base.save(), path: null }, { dirty: true });
      } finally { base.close(); }
    } finally { overlay.remove(); }
  });

  const insertPages = gate("insertPages", async () => {
    const [f] = await pickFiles("application/pdf,.pdf", false);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const at = viewer.currentPageNumber;
    await modify(async (doc) => {
      const src = await PdfDoc.open(bytes);
      importPages(doc, src, allIndexes(src.count), at);
      src.close();
    });
  });

  const extract = gate("extract", async () => {
    const box = html(`<label class="frow"><span>${t("extractWhich")}</span><input class="field" value="${viewer.currentPageNumber}" style="flex:1"></label>
      <label class="frow"><input type="checkbox"> <span>${t("extractSep")}</span></label>`);
    if (await ask(t("extract"), box) !== "ok") return;
    const pages = parseRange(box.querySelector(".field").value, app.doc.pdf.numPages);
    if (!pages.length) return;
    const separate = box.querySelector("[type=checkbox]").checked;
    const src = await PdfDoc.open(await bytesNow(), pw());
    try {
      if (!separate) return platform.saveBytesAs(await pdfFromPages(src, pages), `${baseName()}-pages.pdf`);
      const outs = [];
      for (const i of pages) outs.push({ name: `${baseName()}-p${i + 1}.pdf`, bytes: await pdfFromPages(src, [i]) });
      if (await saveMany(outs, `${baseName()}-pages`)) toast(t("splitDone", { n: outs.length }));
    } finally { src.close(); }
  });

  const split = gate("split", async () => {
    const total = app.doc.pdf.numPages;
    const n = await askNumber(t("split"), t("splitEvery"), t("splitPages"), 1, Math.max(1, Math.ceil(total / 2)));
    if (!n) return;
    const src = await PdfDoc.open(await bytesNow(), pw());
    try {
      const outs = [];
      for (let k = 0; k < total; k += n) {
        const idx = allIndexes(Math.min(n, total - k)).map((x) => x + k);
        outs.push({ name: `${baseName()}-${String(k / n + 1).padStart(2, "0")}.pdf`, bytes: await pdfFromPages(src, idx) });
      }
      if (await saveMany(outs, `${baseName()}-split`)) toast(t("splitDone", { n: outs.length }));
    } finally { src.close(); }
  });

  const crop = gate("crop", async () => {
    const box = html(`<div class="grid4">
      ${["cropTop", "cropBottom", "cropLeft", "cropRight"].map((k) => `<label class="frow"><span>${t(k)}</span><input class="field" type="number" min="0" step="1" value="10" data-k="${k}" style="width:80px"><span>${t("cropUnit")}</span></label>`).join("")}</div>`);
    const range = rangePicker(); box.append(range);
    if (await ask(t("crop"), box) !== "ok") return;
    const mm = (k) => Math.max(0, +box.querySelector(`[data-k="${k}"]`).value || 0) * 72 / 25.4;
    const [top, bottom, left, right] = ["cropTop", "cropBottom", "cropLeft", "cropRight"].map(mm);
    await modify((doc) => {
      for (const i of range.pages(doc.count)) {
        const fr = pageFrame(doc, i);
        // margins are given in upright terms; convert the visual crop rectangle to user space
        const a = fr.toUser(left, bottom), b = fr.toUser(fr.W - right, fr.H - top);
        const l = Math.min(a[0], b[0]), bt = Math.min(a[1], b[1]), rr = Math.max(a[0], b[0]), tp = Math.max(a[1], b[1]);
        if (rr - l > 20 && tp - bt > 20) P().FPDFPage_SetCropBox(doc.page(i), l, bt, rr, tp);
      }
    });
  });

  function tokens(text, i, total) {
    const d = new Date().toLocaleDateString(LANG === "el" ? "el-GR" : undefined);
    return text.replaceAll("{page}", i + 1).replaceAll("{pages}", total).replaceAll("{date}", d).replaceAll("{file}", app.doc.name).replaceAll("{bates}", "");
  }

  const headerFooter = gate("headerFooter", async (preset = null) => {
    const saved = app.store.get("hf", { hl: "", hc: "", hr: "", fl: "", fc: "", fr: "", size: 9, color: "#333333", margin: 12 });
    if (preset === "pages") saved.fc ||= "{page} / {pages}";
    const box = html(`<p class="muted small" style="margin:0 0 10px">${t("hfTokens")}</p>
      <div class="hf"><span></span><b>${t("hfLeft")}</b><b>${t("hfCenter")}</b><b>${t("hfRight")}</b>
      <b>${t("hfHeader")}</b><input class="field" data-k="hl"><input class="field" data-k="hc"><input class="field" data-k="hr">
      <b>${t("hfFooter")}</b><input class="field" data-k="fl"><input class="field" data-k="fc"><input class="field" data-k="fr"></div>
      <div class="frow wrap"><label class="frow"><span>${t("fontSize")}</span><input class="field" type="number" data-k="size" min="5" max="48" style="width:64px"></label>
      <label class="frow"><span>${t("color")}</span><input type="color" class="colorpick" data-k="color"></label>
      <label class="frow"><span>${t("margin")}</span><input class="field" type="number" data-k="margin" min="0" max="80" style="width:64px"><span>mm</span></label></div>`);
    fillFields(box, saved);
    const range = rangePicker(); box.append(range);
    if (await ask(t("headerFooter"), box) !== "ok") return;
    const v = readFields(box);
    app.store.set("hf", v);
    await stampAll(range, (i, total) => [
      ["hl", 0, "top"], ["hc", 0.5, "top"], ["hr", 1, "top"], ["fl", 0, "bottom"], ["fc", 0.5, "bottom"], ["fr", 1, "bottom"],
    ].filter(([k]) => v[k].trim()).map(([k, align, where]) => ({ text: tokens(v[k], i, total), align, where })), { size: +v.size || 9, color: hexRgb(v.color), margin: (+v.margin || 12) * 72 / 25.4 });
  });

  async function stampAll(range, linesFor, { size, color, margin }) {
    await modify(async (doc) => {
      const total = doc.count;
      for (const i of range.pages(total)) {
        const fr = pageFrame(doc, i);
        for (const ln of linesFor(i, total)) {
          const x = ln.align === 0 ? margin : ln.align === 1 ? fr.W - margin : fr.W / 2;
          const y = ln.where === "top" ? fr.H - margin - size : margin;
          await stampText(doc, i, ln.text, { x, y, size, color, align: ln.align });
        }
      }
    });
  }

  const watermark = gate("watermark", async () => {
    const saved = app.store.get("wm", { text: t("wmDefault"), size: 60, color: "#c62828", opacity: 20, angle: 45 });
    const box = html(`<label class="frow"><span>${t("wmText")}</span><input class="field" data-k="text" style="flex:1"></label>
      <div class="frow wrap"><label class="frow"><span>${t("fontSize")}</span><input class="field" type="number" data-k="size" min="8" max="300" style="width:70px"></label>
      <label class="frow"><span>${t("color")}</span><input type="color" class="colorpick" data-k="color"></label>
      <label class="frow"><span>${t("wmOpacity")}</span><input type="range" data-k="opacity" min="5" max="100"></label>
      <label class="frow"><span>${t("wmAngle")}</span><input class="field" type="number" data-k="angle" min="-90" max="90" style="width:64px"><span>°</span></label></div>`);
    fillFields(box, saved);
    const range = rangePicker(); box.append(range);
    if (await ask(t("watermark"), box) !== "ok") return;
    const v = readFields(box);
    app.store.set("wm", v);
    if (!v.text.trim()) return;
    await modify(async (doc) => {
      const total = doc.count;
      for (const i of range.pages(total)) {
        const fr = pageFrame(doc, i);
        await stampText(doc, i, tokens(v.text, i, total), { x: fr.W / 2, y: fr.H / 2, size: +v.size || 60, color: hexRgb(v.color), opacity: (+v.opacity || 20) / 100, angle: +v.angle || 0, bold: true, center: true });
      }
    });
  });

  const bates = gate("bates", async () => {
    const saved = app.store.get("bates", { prefix: "DOC-", start: 1, digits: 6, pos: "fr" });
    const box = html(`<div class="frow wrap">
      <label class="frow"><span>${t("batesPrefix")}</span><input class="field" data-k="prefix" style="width:110px"></label>
      <label class="frow"><span>${t("batesStart")}</span><input class="field" type="number" data-k="start" min="0" style="width:90px"></label>
      <label class="frow"><span>${t("batesDigits")}</span><input class="field" type="number" data-k="digits" min="1" max="12" style="width:64px"></label>
      <label class="frow"><span>${t("batesPos")}</span><select class="field" data-k="pos">
        <option value="hl">${t("hfHeader")} · ${t("hfLeft")}</option><option value="hr">${t("hfHeader")} · ${t("hfRight")}</option>
        <option value="fl">${t("hfFooter")} · ${t("hfLeft")}</option><option value="fc">${t("hfFooter")} · ${t("hfCenter")}</option><option value="fr">${t("hfFooter")} · ${t("hfRight")}</option></select></label></div>`);
    fillFields(box, saved);
    if (await ask(t("bates"), box) !== "ok") return;
    const v = readFields(box);
    app.store.set("bates", v);
    const align = { l: 0, c: 0.5, r: 1 }[v.pos[1]], where = v.pos[0] === "h" ? "top" : "bottom";
    await stampAll({ pages: allIndexes }, (i) => [{ text: v.prefix + String((+v.start || 0) + i).padStart(+v.digits || 6, "0"), align, where }], { size: 9, color: [0, 0, 0], margin: 12 * 72 / 25.4 });
  });

  /* ============================================================ CONVERT */

  async function imageToJpegOrPng(file) {
    const bmp = await createImageBitmap(file);
    const c = el("canvas"); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
    let alpha = false;
    if (/png|webp|gif/i.test(file.type)) { const d = g.getImageData(0, 0, c.width, c.height).data; for (let k = 3; k < d.length; k += 4 * 7) if (d[k] < 250) { alpha = true; break; } }
    const blob = await new Promise((r) => c.toBlob(r, alpha ? "image/png" : "image/jpeg", 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), png: alpha, w: bmp.width, h: bmp.height };
  }

  function placeImage(doc, pageIndex, img, x, y, w, h) {
    const pg = doc.page(pageIndex);
    const obj = P().FPDFPageObj_NewImageObj(doc.h);
    const dp = putBytes(img.bytes);
    let ok;
    if (img.png) { const arr = ints(pg); ok = P().EPDFImageObj_SetPng(arr, 1, obj, dp, img.bytes.length); free(arr); }
    else ok = P().EPDFImageObj_SetJpeg(pg, 0, obj, dp, img.bytes.length);
    free(dp);
    if (!ok) { P().FPDFPageObj_Destroy(obj); return false; }
    P().FPDFImageObj_SetMatrix(obj, w, 0, 0, h, x, y);
    P().FPDFPage_InsertObject(pg, obj);
    P().FPDFPage_GenerateContent(pg);
    return true;
  }

  const imagesToPdf = gate("imagesToPdf", async () => {
    const box = html(`<p class="muted small" style="margin:0 0 10px">${t("imagesHint")}</p>
      <label class="frow"><span>${t("pageSize")}</span><select class="field" data-size><option value="a4">${t("a4")}</option><option value="fit">${t("fitImage")}</option></select></label>`);
    if (await ask(t("imagesToPdf"), box, t("chooseFiles")) !== "ok") return;
    const mode = box.querySelector("[data-size]").value;
    const list = await pickFiles("image/*", true);
    if (!list.length) return;
    const overlay = busy(t("working"));
    try {
      const doc = await PdfDoc.create();
      try {
        for (const f of list) {
          const img = await imageToJpegOrPng(f);
          let W, H, x, y, w, h;
          if (mode === "fit") { W = img.w * 0.75; H = img.h * 0.75; x = y = 0; w = W; h = H; }
          else {
            [W, H] = img.w > img.h ? [842, 595] : [595, 842];
            const m = 24, s = Math.min((W - 2 * m) / img.w, (H - 2 * m) / img.h);
            w = img.w * s; h = img.h * s; x = (W - w) / 2; y = (H - h) / 2;
          }
          const i = doc.count;
          P().FPDFPage_New(doc.h, i, W, H);
          placeImage(doc, i, img, x, y, w, h);
        }
        const name = list.length === 1 ? list[0].name.replace(/\.[^.]+$/, "") : "Images";
        await app.openData({ name: name + ".pdf", data: doc.save(), path: null }, { dirty: true });
      } finally { doc.close(); }
    } finally { overlay.remove(); }
  });

  const exportImages = gate("exportImages", async () => {
    const box = html(`<div class="frow wrap"><label class="frow"><span>${t("imgFormat")}</span><select class="field" data-f><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
      <label class="frow"><span>${t("imgDpi")}</span><select class="field" data-d><option>72</option><option selected>150</option><option>300</option></select></label></div>`);
    const range = rangePicker(); box.append(range);
    if (await ask(t("exportImages"), box) !== "ok") return;
    const fmt = box.querySelector("[data-f]").value, dpi = +box.querySelector("[data-d]").value;
    const pdf = app.doc.pdf, pages = range.pages(pdf.numPages);
    const overlay = busy(t("working"));
    try {
      const outs = [];
      for (const i of pages) {
        const page = await pdf.getPage(i + 1);
        const vp = page.getViewport({ scale: dpi / 72, rotation: (page.rotate + viewer.pagesRotation) % 360 });
        const c = el("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = await new Promise((res) => c.toBlob(res, `image/${fmt}`, 0.92));
        outs.push({ name: `${baseName()}-${String(i + 1).padStart(3, "0")}.${fmt === "jpeg" ? "jpg" : "png"}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        c.width = c.height = 0;
      }
      overlay.remove();
      if (outs.length === 1) await platform.saveBytesAs(outs[0].bytes, outs[0].name);
      else if (await saveMany(outs, `${baseName()}-images`)) toast(t("splitDone", { n: outs.length }));
    } finally { overlay.remove(); }
  });

  /** Groups PDF.js text items into lines and paragraphs. */
  async function readParagraphs(pdf) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      const lines = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str) continue;
        const y = it.transform[5], x = it.transform[4], size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
        const bold = /bold|black|heavy/i.test(tc.styles[it.fontName]?.fontFamily || "") || /bold/i.test(it.fontName);
        let ln = lines.find((l) => Math.abs(l.y - y) < size * 0.4);
        if (!ln) { ln = { y, x, size, bold, parts: [] }; lines.push(ln); }
        ln.parts.push({ x, str: it.str, w: it.width });
        ln.x = Math.min(ln.x, x); ln.size = Math.max(ln.size, size); ln.bold &&= bold;
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) {
        l.parts.sort((a, b) => a.x - b.x);
        let s = "", end = null;
        for (const p of l.parts) { if (end != null && p.x - end > l.size * 0.25 && !s.endsWith(" ") && !p.str.startsWith(" ")) s += " "; s += p.str; end = p.x + p.w; }
        l.text = s.replace(/\s+/g, " ").trim();
      }
      // join lines into paragraphs
      const paras = [];
      let cur = null, prev = null;
      for (const l of lines.filter((x) => x.text)) {
        const gap = prev ? prev.y - l.y : 0;
        const same = cur && gap < prev.size * 1.6 && Math.abs(l.size - prev.size) < 1.5 && l.bold === prev.bold && !/[.:;!?·]$/.test(cur.text);
        if (same) cur.text = cur.text.endsWith("-") ? cur.text.slice(0, -1) + l.text : cur.text + " " + l.text;
        else { cur = { text: l.text, size: l.size, bold: l.bold }; paras.push(cur); }
        prev = l;
      }
      pages.push(paras);
    }
    return pages;
  }

  const exportText = gate("exportText", async () => {
    const overlay = busy(t("working"));
    try {
      const pages = await readParagraphs(app.doc.pdf);
      const text = pages.map((ps) => ps.map((p) => p.text).join("\n\n")).join("\n\n\f\n\n");
      overlay.remove();
      if (await platform.saveBytesAs(new TextEncoder().encode("﻿" + text), `${baseName()}.txt`)) toast(t("exported"));
    } finally { overlay.remove(); }
  });

  const exportWord = gate("exportWord", async () => {
    const overlay = busy(t("working"));
    try {
      const pages = await readParagraphs(app.doc.pdf);
      const docx = makeDocx(pages, { title: baseName() });
      overlay.remove();
      if (await platform.saveBytesAs(docx, `${baseName()}.docx`)) toast(t("wordNote"), 6000);
    } finally { overlay.remove(); }
  });

  const compress = gate("compress", async () => {
    const box = html(`<label class="frow"><span>${t("compressLevel")}</span><select class="field">
      <option value="200">${t("compressHigh")}</option><option value="150" selected>${t("compressMedium")}</option><option value="96">${t("compressLow")}</option></select></label>`);
    if (await ask(t("compress"), box) !== "ok") return;
    const target = +box.querySelector("select").value, quality = target >= 200 ? 0.82 : target >= 150 ? 0.72 : 0.6;
    const before = await bytesNow();
    const overlay = busy(t("working"));
    let out;
    try {
      const doc = await PdfDoc.open(before, pw());
      try {
        for (let i = 0; i < doc.count; i++) {
          const pg = doc.page(i), n = P().FPDFPage_CountObjects(pg);
          let changed = false;
          for (let k = 0; k < n; k++) {
            const obj = P().FPDFPage_GetObject(pg, k);
            if (P().FPDFPageObj_GetType(obj) !== FPDF.IMAGE || P().FPDFPageObj_HasTransparency(obj)) continue;
            const px = (() => { const p = malloc(8); try { return P().FPDFImageObj_GetImagePixelSize(obj, p, p + 4) ? [M().getValue(p, "i32"), M().getValue(p + 4, "i32")] : null; } finally { free(p); } })();
            const b = readFloats(4, (p) => P().FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
            if (!px || !b || px[0] * px[1] < 40000) continue;
            const dpi = px[0] / Math.max(1, (b[2] - b[0]) / 72);
            const scale = Math.min(1, target / dpi);
            const bitmap = P().FPDFImageObj_GetBitmap(obj);
            if (!bitmap) continue;
            const w = P().FPDFBitmap_GetWidth(bitmap), h = P().FPDFBitmap_GetHeight(bitmap), stride = P().FPDFBitmap_GetStride(bitmap), fmt = P().FPDFBitmap_GetFormat(bitmap);
            const buf = P().FPDFBitmap_GetBuffer(bitmap), src = heap();
            const rgba = new ImageData(w, h), d = rgba.data, bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              const s = buf + y * stride + x * bpp, o = (y * w + x) * 4;
              if (bpp === 1) d[o] = d[o + 1] = d[o + 2] = src[s];
              else { d[o] = src[s + 2]; d[o + 1] = src[s + 1]; d[o + 2] = src[s]; }
              d[o + 3] = 255;
            }
            P().FPDFBitmap_Destroy(bitmap);
            const c1 = el("canvas"); c1.width = w; c1.height = h; c1.getContext("2d").putImageData(rgba, 0, 0);
            const c2 = el("canvas"); c2.width = Math.max(1, Math.round(w * scale)); c2.height = Math.max(1, Math.round(h * scale));
            const g2 = c2.getContext("2d"); g2.imageSmoothingQuality = "high"; g2.drawImage(c1, 0, 0, c2.width, c2.height);
            const jpg = new Uint8Array(await (await new Promise((res) => c2.toBlob(res, "image/jpeg", quality))).arrayBuffer());
            const dp = putBytes(jpg);
            if (P().EPDFImageObj_SetJpeg(pg, 0, obj, dp, jpg.length)) changed = true;
            free(dp);
          }
          if (changed) P().FPDFPage_GenerateContent(pg);
        }
        out = doc.save();
      } finally { doc.close(); }
    } finally { overlay.remove(); }
    const a = before.length, b = out.length; // read sizes now: the viewer takes ownership of the buffers
    if (b >= a * 0.97) { toast(t("compressNone"), 5000); return; }
    await app.replaceDocumentData(out);
    toast(t("compressResult", { a: sizeStr(a), b: sizeStr(b), p: Math.round(100 - b * 100 / a) }), 6000);
  });

  /* ============================================================ FORMS */

  const prepareForm = gate("prepareForm", async () => {
    const opts = html(`<select class="field sm" data-type>
      <option value="${FPDF.FIELD_TEXT}">${t("fieldText")}</option><option value="${FPDF.FIELD_CHECK}">${t("fieldCheck")}</option>
      <option value="${FPDF.FIELD_SIGN}">${t("fieldSign")}</option></select>`).firstElementChild;
    const detectBtn = el("button", t("detectFields"), { className: "btn sm secondary" });
    const counter = { text: 0, check: 0, sign: 0 };
    const nameFor = (type) => type == FPDF.FIELD_CHECK ? `Check${++counter.check}` : type == FPDF.FIELD_SIGN ? `Signature${++counter.sign}` : `Text${++counter.text}`;
    const labelFor = (type) => ({ [FPDF.FIELD_TEXT]: t("fieldText"), [FPDF.FIELD_CHECK]: t("fieldCheck"), [FPDF.FIELD_SIGN]: t("fieldSign") })[type];
    detectBtn.onclick = async () => {
      const found = await detectFieldAreas(app.doc.pdf);
      pick.add(found.map((f) => ({ ...f, type: FPDF.FIELD_TEXT, name: nameFor(FPDF.FIELD_TEXT), label: t("fieldText") })));
      toast(t("detected", { n: found.length }));
    };
    const items = await pick.start({
      title: t("prepareForm"), hint: t("formHint"), options: opts, extra: [detectBtn], boxClass: "field-box",
      onAdd: (it) => { it.type = +opts.value; it.name = nameFor(it.type); it.label = labelFor(it.type); },
      countText: (n) => n ? t("fieldsAdded", { n }) : "",
    });
    if (!items?.length) return;
    await modify((doc) => {
      const form = doc.enableForms();
      for (const it of items) {
        const pg = doc.page(it.page);
        let [l, b, r, tp] = it.rect;
        if (it.type === FPDF.FIELD_CHECK) { const s = Math.min(r - l, tp - b, 18); r = l + s; tp = b + s; }
        const np = wstr(it.name);
        const a = P().EPDFPage_CreateFormField(pg, form, it.type, np);
        free(np);
        if (!a) continue;
        const rp = floats(l, tp, r, b); P().FPDFAnnot_SetRect(a, rp); free(rp);
        P().EPDFAnnot_GenerateFormFieldAP(a);
        P().FPDFPage_CloseAnnot(a);
      }
    });
    toast(t("fieldsAdded", { n: items.length }));
  });

  /** Finds blank lines like "Name: ________" and returns areas for text fields. */
  async function detectFieldAreas(pdf) {
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        const re = /_{4,}|\.{6,}|…{3,}/g; let m;
        while ((m = re.exec(it.str))) {
          const per = it.width / Math.max(1, it.str.length);
          const x0 = it.transform[4] + per * m.index, x1 = x0 + per * m[0].length;
          const y = it.transform[5], h = Math.max(it.height || 10, 10);
          out.push({ page: n - 1, rect: [x0, y - 2, x1, y + h * 1.2] });
        }
      }
    }
    return out;
  }

  /* ============================================================ SECURITY */

  const protect = gate("protect", async () => {
    const box = html(`<label class="frow col"><span>${t("openPw")}</span><input class="field" type="password" data-u autocomplete="new-password"></label>
      <label class="frow col"><span>${t("ownerPw")}</span><input class="field" type="password" data-o autocomplete="new-password"></label>
      <div class="checks">
        <label><input type="checkbox" data-p="2052" checked> ${t("allowPrint")}</label>
        <label><input type="checkbox" data-p="528" checked> ${t("allowCopy")}</label>
        <label><input type="checkbox" data-p="1032"> ${t("allowEdit")}</label>
        <label><input type="checkbox" data-p="288" checked> ${t("allowComment")}</label></div>`);
    if (await ask(t("protect"), box) !== "ok") return;
    const user = box.querySelector("[data-u]").value, owner = box.querySelector("[data-o]").value;
    if (!user && !owner) { toast(t("pwMismatch")); return; }
    let flags = 0xfffff0c0;
    for (const c of box.querySelectorAll("[data-p]")) if (c.checked) flags |= +c.dataset.p;
    // without an explicit permissions password, use a random one so restrictions can't be lifted trivially
    const ownerPw = owner || Array.from(crypto.getRandomValues(new Uint8Array(18)), (x) => x.toString(16).padStart(2, "0")).join("");
    const overlay = busy(t("working"));
    try {
      const doc = await PdfDoc.open(await bytesNow(), pw());
      let out;
      try { if (!P().EPDF_SetEncryption(doc.h, user, ownerPw, flags | 0)) throw new Error("encryption failed"); out = doc.save(); } finally { doc.close(); }
      app.doc.password = user || undefined; // the viewer reopens the protected file with the new password
      await app.replaceDocumentData(out);
    } finally { overlay.remove(); }
    toast(t("protected"), 5000);
  });

  const removeSecurity = gate("removeSecurity", async () => {
    const enc = await app.doc.pdf.getPermissions().catch(() => null);
    if (!app.doc.password && !enc) { toast(t("notProtected")); return; }
    const doc = await PdfDoc.open(await bytesNow(), pw());
    let out;
    try { P().EPDF_RemoveEncryption(doc.h); out = doc.save(); } finally { doc.close(); }
    app.doc.password = undefined;
    await app.replaceDocumentData(out);
    toast(t("unprotected"), 5000);
  });

  const sanitize = gate("sanitize", async () => {
    let removed = 0;
    await modify((doc) => {
      for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"]) { const p = wstr(""); P().EPDF_SetMetaText(doc.h, key, p); free(p); }
      for (let n = P().FPDFDoc_GetAttachmentCount(doc.h); n > 0; n--) if (P().FPDFDoc_DeleteAttachment(doc.h, n - 1)) removed++;
    });
    toast(t("sanitized", { n: removed }), 5000);
  });

  const redact = gate("redact", async () => {
    const findBtn = el("button", t("redactFind"), { className: "btn sm secondary" });
    findBtn.onclick = async () => {
      const box = html(`<input class="field" style="width:100%" placeholder="${t("redactSearch")}">`).firstElementChild;
      if (await ask(t("redactFind"), box) !== "ok" || !box.value.trim()) return;
      const found = await findTextAreas(app.doc.pdf, box.value.trim());
      pick.add(found);
      toast(t("redactMarked", { n: found.length }));
    };
    const items = await pick.start({ title: t("redact"), hint: t("redactHint"), boxClass: "redact-box", extra: [findBtn], countText: (n) => n ? t("redactMarked", { n }) : "" });
    if (!items?.length) return;
    await modify((doc) => {
      const byPage = new Map();
      for (const it of items) (byPage.get(it.page) || byPage.set(it.page, []).get(it.page)).push(it.rect);
      for (const [i, rects] of byPage) {
        const pg = doc.page(i);
        for (const [l, b, r, tp] of rects) {
          const rp = floats(l, tp, r, b);
          P().EPDFText_RedactInRect(pg, rp, true, false);
          free(rp);
          // remove images that touch the area
          for (let k = P().FPDFPage_CountObjects(pg) - 1; k >= 0; k--) {
            const obj = P().FPDFPage_GetObject(pg, k);
            if (P().FPDFPageObj_GetType(obj) !== FPDF.IMAGE) continue;
            const bb = readFloats(4, (p) => P().FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
            if (bb && bb[0] < r && bb[2] > l && bb[1] < tp && bb[3] > b && P().FPDFPage_RemoveObject(pg, obj)) P().FPDFPageObj_Destroy(obj);
          }
          const box = P().FPDFPageObj_CreateNewRect(l, b, r - l, tp - b);
          P().FPDFPageObj_SetFillColor(box, 0, 0, 0, 255);
          P().FPDFPath_SetDrawMode(box, 1, false);
          P().FPDFPage_InsertObject(pg, box);
        }
        P().FPDFPage_GenerateContent(pg);
      }
    });
    toast(t("redactDone"), 6000);
  });

  async function findTextAreas(pdf, needle) {
    const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const q = fold(needle), out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      for (const it of tc.items) {
        if (!("str" in it) || !it.str) continue;
        const s = fold(it.str); let k = s.indexOf(q);
        while (k >= 0) {
          const per = it.width / Math.max(1, it.str.length), x0 = it.transform[4] + per * k, y = it.transform[5], h = Math.max(it.height || 10, 6);
          out.push({ page: n - 1, rect: [x0 - 1, y - h * 0.25, x0 + per * q.length + 1, y + h * 0.95] });
          k = s.indexOf(q, k + q.length);
        }
      }
    }
    return out;
  }

  /* ============================================================ COMMENTS */

  const notes = gate("notes", async () => {
    const at = await pick.start({ title: t("notes"), hint: t("noteHint"), mode: "point" });
    if (!at?.length) return;
    const box = html(`<textarea class="field" rows="5" style="width:100%;height:auto;padding:8px"></textarea>`).firstElementChild;
    if (await ask(t("noteText"), box) !== "ok" || !box.value.trim()) return;
    const [{ page, point: [x, y] }] = at;
    await modify((doc) => {
      const pg = doc.page(page);
      const a = P().EPDFPage_CreateAnnot(pg, FPDF.ANNOT_TEXT);
      const rp = floats(x, y, x + 20, y - 20); P().FPDFAnnot_SetRect(a, rp); free(rp);
      const cp = wstr(box.value); P().FPDFAnnot_SetStringValue(a, "Contents", cp); free(cp);
      const tp = wstr(app.store.get("author", "") || ""); P().FPDFAnnot_SetStringValue(a, "T", tp); free(tp);
      P().EPDFAnnot_SetColor(a, 0, 255, 204, 0);
      P().FPDFPage_CloseAnnot(a);
    });
    refreshComments();
  });

  const shapes = gate("shapes", async (kind = "rect") => {
    const opts = html(`<select class="field sm" data-k>
      <option value="rect">${t("shapeRect")}</option><option value="ellipse">${t("shapeEllipse")}</option><option value="line">${t("shapeLine")}</option><option value="arrow">${t("shapeArrow")}</option></select>
      <input type="color" class="colorpick" value="#d32f2f" data-c><label class="frow small"><span>${t("width")}</span><input type="number" class="field sm" min="1" max="12" value="2" style="width:56px" data-w></label>`);
    opts.querySelector("[data-k]").value = kind;
    const items = await pick.start({ title: t("shapes"), hint: t("shapeHint"), options: opts, boxClass: "shape-box",
      onAdd: (it) => { it.kind = opts.querySelector("[data-k]").value; it.color = hexRgb(opts.querySelector("[data-c]").value); it.width = +opts.querySelector("[data-w]").value || 2; } });
    if (!items?.length) return;
    await modify((doc) => {
      for (const it of items) {
        const pg = doc.page(it.page);
        const type = it.kind === "rect" ? FPDF.ANNOT_SQUARE : it.kind === "ellipse" ? FPDF.ANNOT_CIRCLE : FPDF.ANNOT_LINE;
        const a = P().EPDFPage_CreateAnnot(pg, type);
        const pad = type === FPDF.ANNOT_LINE ? it.width * 3 : 0, [l, b, r, tp] = it.rect;
        const rp = floats(l - pad, tp + pad, r + pad, b - pad); P().FPDFAnnot_SetRect(a, rp); free(rp);
        P().EPDFAnnot_SetColor(a, 0, ...it.color);
        P().FPDFAnnot_SetBorder(a, 0, 0, it.width);
        if (type === FPDF.ANNOT_LINE) {
          const s = floats(...it.start), e = floats(...it.end);
          P().EPDFAnnot_SetLine(a, s, e); free(s); free(e);
          if (it.kind === "arrow") P().EPDFAnnot_SetLineEndings(a, 0, 5);
        }
        P().EPDFAnnot_GenerateAppearance(a);
        P().FPDFPage_CloseAnnot(a);
      }
    });
    refreshComments();
  });

  const STAMP_KEYS = [["stampApproved", "#2e7d32"], ["stampReviewed", "#1565c0"], ["stampReceived", "#1565c0"], ["stampFinal", "#2e7d32"],
    ["stampDraft", "#6d4c41"], ["stampConfidential", "#c62828"], ["stampRejected", "#c62828"], ["stampVoid", "#c62828"]];
  function stampImage(text, color, withDate) {
    const date = withDate ? new Date().toLocaleDateString(LANG === "el" ? "el-GR" : undefined) : "";
    const c = el("canvas"), g = c.getContext("2d"), font = '700 64px "Flipleaf Sans", Arial, sans-serif';
    g.font = font;
    const w = Math.ceil(Math.max(g.measureText(text).width, withDate ? g.measureText(date).width * 0.5 : 0)) + 80, h = withDate ? 170 : 120;
    c.width = w; c.height = h;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 8;
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 18); g.stroke();
    g.font = font; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, withDate ? 62 : h / 2 + 2);
    if (withDate) { g.font = '600 32px "Flipleaf Sans", Arial, sans-serif'; g.fillText(date, w / 2, 122); }
    return c;
  }
  const stamps = gate("stamps", async () => {
    await document.fonts?.load?.('700 64px "Flipleaf Sans"');
    const box = html(`<div class="stampgrid"></div><label class="frow"><span>${t("stampCustom")}</span><input class="field" data-t style="flex:1"><input type="color" class="colorpick" value="#1565c0" data-c></label>
      <label class="frow"><input type="checkbox" data-d checked> <span>${t("stampAddDate")}</span></label>`);
    let chosen = null;
    const grid = box.querySelector(".stampgrid");
    for (const [k, color] of STAMP_KEYS) {
      const b = el("button"); b.type = "button"; b.className = "stampbtn";
      const img = stampImage(t(k), color, false); img.style.width = "100%";
      b.append(img);
      b.onclick = () => { chosen = { text: t(k), color }; closeDialog("ok"); };
      grid.append(b);
    }
    if (await ask(t("stamps"), box) !== "ok") return;
    if (!chosen) { const tx = box.querySelector("[data-t]").value.trim(); if (!tx) return; chosen = { text: tx.toUpperCase(), color: box.querySelector("[data-c]").value }; }
    const canvas = stampImage(chosen.text, chosen.color, box.querySelector("[data-d]").checked);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    await app.addImage(new File([blob], "stamp.png", { type: "image/png" }));
  });

  /* comments panel */
  const SUBTYPES = { Text: "noteText", FreeText: "hlText", Highlight: "hlHighlight", Underline: "hlHighlight", StrikeOut: "hlHighlight", Ink: "hlInk", Square: "shapeRect", Circle: "shapeEllipse", Line: "shapeLine", Polygon: "shapes", PolyLine: "shapes", Stamp: "stamps", FileAttachment: "orgInsert", Caret: "noteText" };
  async function refreshComments() {
    const box = document.getElementById("comments");
    if (!box || box.hidden || !app.doc.pdf) return;
    const pdf = app.doc.pdf, rows = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const anns = await (await pdf.getPage(n)).getAnnotations();
      for (const a of anns) if (SUBTYPES[a.subtype]) rows.push({ n, a });
    }
    if (pdf !== app.doc.pdf) return;
    if (!rows.length) { box.innerHTML = `<p class="empty">${t("noComments")}</p>`; return; }
    box.replaceChildren(...rows.map(({ n, a }) => {
      const it = html(`<div class="comment"><div class="chead"><b></b><span class="muted small"></span><button class="btn icon sm" title="${t("deleteComment")}">${icon("trash-2", 14)}</button></div><p></p></div>`).firstElementChild;
      it.querySelector("b").textContent = t(SUBTYPES[a.subtype]);
      it.querySelector("span").textContent = `${t("page")} ${n}${a.titleObj?.str ? " · " + a.titleObj.str : ""}`;
      it.querySelector("p").textContent = a.contentsObj?.str || a.textContent?.join?.(" ") || "";
      it.onclick = (e) => {
        if (e.target.closest("button")) return;
        viewer.scrollPageIntoView({ pageNumber: n, destArray: [null, { name: "XYZ" }, a.rect[0] - 40, a.rect[3] + 40, null] });
      };
      it.querySelector("button").onclick = async () => {
        const obj = parseInt(a.id, 10);
        await modify((doc) => { if (!P().EPDFPage_RemoveAnnotByObjectNumber(doc.page(n - 1), obj)) return false; });
        refreshComments();
      };
      return it;
    }));
  }
  eventBus.on("pagesloaded", () => refreshComments());

  /* compare */
  const compare = gate("compare", async () => {
    const [f] = await pickFiles("application/pdf,.pdf", false);
    if (!f) return;
    const overlay = busy(t("working"));
    let report;
    try {
      const other = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
      const [a, b] = await Promise.all([readParagraphs(app.doc.pdf), readParagraphs(other)]);
      const lines = (pages) => pages.flatMap((ps, i) => ps.map((p) => ({ page: i + 1, text: p.text })));
      report = diff(lines(a), lines(b));
      other.loadingTask?.destroy?.();
    } finally { overlay.remove(); }
    const box = el("div");
    const added = report.filter((r) => r.op === "+"), removed = report.filter((r) => r.op === "-");
    const pages = new Set(report.map((r) => r.page));
    box.append(el("p", added.length + removed.length ? t("compareSummary", { a: added.length, r: removed.length, p: pages.size }) : t("compareSame"), { className: "muted" }));
    const list = el("div"); list.className = "difflist";
    for (const r of report.slice(0, 600)) {
      const row = el("div"); row.className = "diff " + (r.op === "+" ? "add" : "del");
      row.append(el("span", `${r.op === "+" ? t("compareAdded") : t("compareRemoved")} · ${t("page")} ${r.page}`, { className: "small muted" }), el("div", r.text));
      list.append(row);
    }
    box.append(list);
    await wideDialog({ title: `${t("compare")} — ${app.doc.name} ↔ ${f.name}`, body: box, buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] });
  });

  /** Line diff (LCS). Lines only in `a` are removed (−), only in `b` are added (+). */
  function diff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) { // too big for full LCS: compare as sets
      const sa = new Set(a.map((x) => x.text)), sb = new Set(b.map((x) => x.text));
      return [...a.filter((x) => !sb.has(x.text)).map((x) => ({ ...x, op: "-" })), ...b.filter((x) => !sa.has(x.text)).map((x) => ({ ...x, op: "+" }))];
    }
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].text === b[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i].text === b[j].text) { i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ ...a[i++], op: "-" });
      else out.push({ ...b[j++], op: "+" });
    }
    while (i < n) out.push({ ...a[i++], op: "-" });
    while (j < m) out.push({ ...b[j++], op: "+" });
    return out;
  }

  /* ============================================================ catalogue (menus & "All tools") */

  const TOOLS = [
    { cat: "catEdit", items: [
      { id: "organize", icon: "layout-grid", run: organize }, { id: "combine", icon: "copy", run: combine, noDoc: true },
      { id: "insertPages", icon: "plus", run: insertPages }, { id: "extract", icon: "download", run: extract }, { id: "split", icon: "columns-2", run: split },
      { id: "crop", icon: "scale", run: crop }, { id: "headerFooter", icon: "a-large-small", run: () => headerFooter() },
      { id: "watermark", icon: "type", run: watermark }, { id: "bates", icon: "keyboard", run: bates } ] },
    { cat: "catConvert", items: [
      { id: "imagesToPdf", icon: "image-plus", run: imagesToPdf, noDoc: true }, { id: "exportWord", icon: "file-text", run: exportWord },
      { id: "exportImages", icon: "image-plus", run: exportImages }, { id: "exportText", icon: "scroll-text", run: exportText },
      { id: "compress", icon: "minus", run: compress } ] },
    { cat: "catForms", items: [
      { id: "prepareForm", icon: "text-cursor-input", run: prepareForm }, { id: "toolSign", icon: "signature", run: () => app.signDialog(), free: true } ] },
    { cat: "catSecurity", items: [
      { id: "protect", icon: "scale", run: protect }, { id: "removeSecurity", icon: "x", run: removeSecurity },
      { id: "redact", icon: "eraser", run: redact }, { id: "sanitize", icon: "trash-2", run: sanitize } ] },
    { cat: "catComments", items: [
      { id: "notes", icon: "file-pen-line", run: notes }, { id: "commentsPanel", icon: "list-tree", run: () => app.showCommentsPanel() },
      { id: "stamps", icon: "check", run: stamps }, { id: "shapes", icon: "square", run: () => shapes("rect") }, { id: "compare", icon: "columns-2", run: compare } ] },
  ];

  function menuItems(cat) {
    const group = TOOLS.find((g) => g.cat === cat);
    return group.items.map((it) => ({ label: it.id, icon: it.icon, pro: !it.free, run: it.run, when: () => !!app.doc.pdf || it.noDoc }));
  }

  async function allTools() {
    const box = el("div"); box.className = "alltools";
    for (const g of TOOLS) {
      const sec = el("section"); sec.append(el("h4", t(g.cat)));
      const grid = el("div"); grid.className = "tgrid";
      for (const it of g.items) {
        const b = el("button"); b.type = "button"; b.className = "tcard";
        b.disabled = !app.doc.pdf && !it.noDoc;
        b.innerHTML = `${icon(it.icon, 20)}<span></span>${it.free ? "" : `<em class="probadge">${t("pro")}</em>`}`;
        b.querySelector("span").textContent = t(it.id).replace(/…$/, "");
        b.onclick = () => { closeDialog("cancel"); setTimeout(() => it.run(), 50); };
        grid.append(b);
      }
      sec.append(grid); box.append(sec);
    }
    if (plan() === "launch") box.append(el("p", t("launchFree"), { className: "muted small" }));
    await wideDialog({ title: t("allTools"), body: box, buttons: [] });
  }

  return { menuItems, allTools, refreshComments, pickActive: () => pick.active, organize, combine, imagesToPdf, protect, redact, compare, exportWord, compress, notes, shapes, stamps, prepareForm, headerFooter };
}
