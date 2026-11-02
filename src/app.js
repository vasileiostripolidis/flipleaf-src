// Flipleaf — a feather-light PDF reader.
// Rendering, forms, links, find and annotation editing come from Mozilla PDF.js (Apache-2.0).
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
import { hydrateIcons, icon } from "./icons.js";
import { t, shortcut, translateDom, LANG } from "./i18n.js";
import * as platform from "./platform.js";

globalThis.pdfjsLib = pdfjsLib; // the viewer components expect it here
const { EventBus, PDFViewer, PDFLinkService, PDFFindController, ScrollMode, SpreadMode, LinkTarget } =
  await import("./vendor/pdfjs/web/pdf_viewer.mjs");
const { AnnotationEditorType: ED, AnnotationEditorParamsType: EP, AnnotationMode, PDFDateString } = pdfjsLib;

const VERSION = "1.1.0";
const BASE = new URL("./vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("flipleaf." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("flipleaf." + k, JSON.stringify(v)); } catch {} },
};

translateDom();
hydrateIcons();
$("findInput").placeholder = t("findPlaceholder");

/* ================================================================== viewer */

const container = $("viewerContainer");
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: "noopener noreferrer nofollow" });
const findController = new PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
const viewer = new PDFViewer({
  container,
  viewer: $("viewer"),
  eventBus,
  linkService,
  findController,
  annotationMode: AnnotationMode.ENABLE_FORMS,
  annotationEditorMode: ED.NONE,
  annotationEditorHighlightColors: "yellow=#FFF066,green=#7CF2A6,blue=#8ADBFF,pink=#FFB3D9,red=#FF7A7A",
  imageResourcesPath: BASE + "web/images/",
  enableHighlightFloatingButton: false,
  maxCanvasPixels: 2 ** 25,
});
linkService.setViewer(viewer);

let uiManager = null; // AnnotationEditorUIManager, created by the viewer per document
eventBus.on("annotationeditoruimanager", ({ uiManager: m }) => (uiManager = m));

/* ================================================================== document state */

const doc = { pdf: null, task: null, name: "", path: null, size: 0, dirty: false, key: "" };

async function openData({ name, data, path }) {
  if (!(await confirmDiscard())) return;
  const size = data.byteLength; // PDF.js takes ownership of `data`
  await closeDocument();
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: BASE + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: BASE + "standard_fonts/",
    wasmUrl: BASE + "wasm/",
    iccUrl: BASE + "iccs/",
    isEvalSupported: false,
    enableXfa: true,
  });
  doc.task = loadingTask;
  loadingTask.onPassword = async (update, reason) => {
    const pw = await askPassword(name, reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    if (pw === null) loadingTask.destroy(); else update(pw);
  };
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    if (doc.task === loadingTask && e?.name !== "AbortException" && !/destroyed/i.test(e?.message)) {
      toast(e?.name === "InvalidPDFException" ? t("invalid") : t("failed", { err: e?.message || e }));
    }
    return;
  }
  if (doc.task !== loadingTask) { pdf.destroy(); return; }

  Object.assign(doc, { pdf, name, path, size, dirty: false, key: pdf.fingerprints[0] });
  pdf.annotationStorage.onSetModified = () => setDirty(true);
  pdf.annotationStorage.onResetModified = () => setDirty(false);

  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  document.body.classList.remove("no-doc");
  $("home").hidden = true;

  const meta = await pdf.getMetadata().catch(() => null);
  const title = meta?.info?.Title?.trim();
  $("docTitle").textContent = name;
  $("docTitle").title = title && title !== name ? title : "";
  updateTitle();
  $("pageCount").textContent = "/ " + pdf.numPages;

  buildThumbnails();
  buildOutline();
  pdf.getFieldObjects().then((f) => { if (f && Object.keys(f).length) toast(t("forms"), 5000); }).catch(() => {});
  container.focus();
}

async function closeDocument() {
  stopReading();
  setTool("select");
  if (doc.task) { const task = doc.task; doc.task = null; await task.destroy().catch(() => {}); }
  doc.pdf = null;
  viewer.setDocument(null);
  linkService.setDocument(null);
  thumbs.reset();
  $("outline").replaceChildren();
}

function setDirty(on) {
  doc.dirty = on;
  $("dirtyDot").hidden = !on;
  $("dirtyDot").title = t("unsaved");
  updateTitle();
}
function updateTitle() {
  platform.setWindowTitle(doc.pdf ? `${doc.dirty ? "• " : ""}${doc.name} — Flipleaf` : "Flipleaf");
}

// restore page, zoom and layout per document
eventBus.on("pagesinit", () => {
  const saved = store.get("view." + doc.key, null);
  applyLayout(store.get("layout", "scroll"), false);
  viewer.currentScaleValue = saved?.scale || store.get("zoom", "auto");
  if (saved?.rotation) viewer.pagesRotation = saved.rotation;
  if (saved?.page > 1 && saved.page <= doc.pdf.numPages) viewer.currentPageNumber = saved.page;
});
function rememberView() {
  if (!doc.pdf || !doc.key) return;
  const v = viewer.currentScaleValue;
  store.set("view." + doc.key, { page: viewer.currentPageNumber, scale: isNaN(+v) ? v : +v, rotation: viewer.pagesRotation });
}
let viewTimer;
eventBus.on("pagechanging", () => { clearTimeout(viewTimer); viewTimer = setTimeout(rememberView, 400); });
addEventListener("pagehide", rememberView);

/* ================================================================== opening */

async function openPicker() {
  const file = await platform.pickFile().catch((e) => { toast(t("failed", { err: e })); return null; });
  if (file) openData(file);
}
async function openPath(path) {
  try { await openData(await platform.readPath(path)); }
  catch (e) { toast(t("failed", { err: e })); refreshRecent(); }
}
async function openFile(file) {
  if (!file) return;
  if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { toast(t("notPdf")); return; }
  openData(await platform.fromFile(file));
}

$("fileInput").addEventListener("change", (e) => openFile(e.target.files[0]));
$("btnOpen").onclick = openPicker;
$("btnOpenHome").onclick = openPicker;
platform.onOpenRequest(openPath);

// remote file in the web version: ?file=https://…
const remote = new URLSearchParams(location.search).get("file");
if (remote && !platform.isDesktop) {
  fetch(remote).then((r) => r.arrayBuffer()).then((b) =>
    openData({ name: decodeURIComponent(remote.split("/").pop().split("?")[0]) || "document.pdf", data: new Uint8Array(b), path: null })
  ).catch((e) => toast(t("failed", { err: e.message })));
}

async function refreshRecent() {
  const list = await platform.recentFiles();
  $("recentWrap").hidden = !list.length;
  $("recentList").replaceChildren(...list.slice(0, 8).map(({ path, name }) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "btn";
    b.innerHTML = icon("file-text", 20) + `<span class="meta"><span class="name"></span><span class="path"></span></span>`;
    b.querySelector(".name").textContent = name;
    b.querySelector(".path").textContent = path;
    b.title = path;
    b.onclick = () => openPath(path);
    b.oncontextmenu = (e) => { e.preventDefault(); platform.forgetRecent(path).then(refreshRecent); };
    li.append(b);
    return li;
  }));
}
refreshRecent();

/* ================================================================== saving */

async function documentBytes() {
  return doc.pdf.annotationStorage.size > 0 ? doc.pdf.saveDocument() : doc.pdf.getData();
}
function suggestedName() {
  return /\.pdf$/i.test(doc.name) ? doc.name : doc.name + ".pdf";
}

async function save({ as = false } = {}) {
  if (!doc.pdf) return false;
  try {
    const bytes = await documentBytes();
    let where;
    if (!as && doc.path && platform.isDesktop) where = await platform.saveToPath(bytes, doc.path);
    else where = await platform.saveAs(bytes, suggestedName());
    if (!where) return false; // cancelled
    if (where !== "download") { doc.path = where; doc.name = where.split(/[\\/]/).pop(); $("docTitle").textContent = doc.name; }
    doc.pdf.annotationStorage.resetModified();
    setDirty(false);
    toast(where === "download" ? t("saved") : t("savedTo", { path: where }));
    refreshRecent();
    return true;
  } catch (e) {
    toast(t("saveFailed", { err: e?.message || e }), 6000);
    return false;
  }
}
$("btnSave").onclick = () => save();

/** Asks to save unsaved changes. Resolves true when it's OK to continue. */
async function confirmDiscard() {
  if (!doc.pdf || !doc.dirty) return true;
  const choice = await dialog({
    title: t("discardTitle"),
    body: text(t("discardBody", { name: doc.name })),
    buttons: [
      { label: t("discard"), value: "discard", kind: "secondary" },
      { label: t("cancel"), value: "cancel", kind: "secondary" },
      { label: t("saveAndContinue"), value: "save", kind: "primary" },
    ],
  });
  if (choice === "save") return save();
  return choice === "discard";
}
const closeGuard = async () => confirmDiscard();
closeGuard.isDirty = () => doc.dirty;
platform.guardClose(closeGuard);

/* ================================================================== navigation & zoom */

const pageInput = $("pageInput");
eventBus.on("pagechanging", ({ pageNumber }) => {
  pageInput.value = pageNumber;
  $("btnPrev").disabled = pageNumber <= 1;
  $("btnNext").disabled = pageNumber >= viewer.pagesCount;
  thumbs.setActive(pageNumber);
});
pageInput.addEventListener("change", () => {
  const n = parseInt(pageInput.value, 10);
  if (n >= 1 && n <= viewer.pagesCount) viewer.currentPageNumber = n;
  else pageInput.value = viewer.currentPageNumber;
});
pageInput.addEventListener("focus", () => pageInput.select());
$("btnPrev").onclick = () => viewer.previousPage();
$("btnNext").onclick = () => viewer.nextPage();

const zoomSelect = $("zoomSelect");
eventBus.on("scalechanging", ({ scale, presetValue }) => {
  const custom = $("zoomCustom");
  const preset = presetValue || [...zoomSelect.options].find((o) => o.value !== "custom" && Math.abs(+o.value - scale) < 1e-3)?.value;
  if (preset) { zoomSelect.value = preset; custom.hidden = true; }
  else { custom.textContent = Math.round(scale * 100) + "%"; custom.hidden = false; zoomSelect.value = "custom"; }
  if (presetValue) store.set("zoom", presetValue);
});
zoomSelect.onchange = () => { if (zoomSelect.value !== "custom") viewer.currentScaleValue = zoomSelect.value; container.focus(); };
$("btnZoomIn").onclick = () => viewer.increaseScale();
$("btnZoomOut").onclick = () => viewer.decreaseScale();
container.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !doc.pdf) return;
  e.preventDefault();
  if (e.deltaY < 0) viewer.increaseScale({ drawingDelay: 300, scaleFactor: Math.exp(-e.deltaY / 300) });
  else viewer.decreaseScale({ drawingDelay: 300, scaleFactor: Math.exp(-e.deltaY / 300) });
}, { passive: false });

function rotate(delta) {
  if (!doc.pdf) return;
  viewer.pagesRotation = (viewer.pagesRotation + delta + 360) % 360;
  thumbs.rerender();
  rememberView();
}

const LAYOUTS = {
  single: [ScrollMode.PAGE, SpreadMode.NONE],
  scroll: [ScrollMode.VERTICAL, SpreadMode.NONE],
  two: [ScrollMode.PAGE, SpreadMode.ODD],
  twoScroll: [ScrollMode.VERTICAL, SpreadMode.ODD],
};
function applyLayout(name, persist = true) {
  const [scroll, spread] = LAYOUTS[name] || LAYOUTS.scroll;
  viewer.scrollMode = scroll;
  viewer.spreadMode = spread;
  for (const b of document.querySelectorAll('[data-act="layout"]')) b.setAttribute("aria-checked", b.dataset.v === name);
  if (persist) store.set("layout", name);
}

/* ================================================================== tools */

const TOOLS = {
  highlight: { mode: ED.HIGHLIGHT, label: "hlHighlight", hint: "hintHighlight", colorParam: EP.HIGHLIGHT_COLOR, sizeParam: EP.HIGHLIGHT_THICKNESS,
    colors: ["#FFF066", "#7CF2A6", "#8ADBFF", "#FFB3D9", "#FF7A7A"], size: [8, 24, 12], sizeLabel: "thickness" },
  ink: { mode: ED.INK, label: "hlInk", hint: "hintInk", colorParam: EP.INK_COLOR, sizeParam: EP.INK_THICKNESS,
    colors: ["#111111", "#1D4ED8", "#DC2626", "#15803D", "#F59E0B"], size: [1, 20, 2], sizeLabel: "thickness" },
  freetext: { mode: ED.FREETEXT, label: "hlText", hint: "hintText", colorParam: EP.FREETEXT_COLOR, sizeParam: EP.FREETEXT_SIZE,
    colors: ["#111111", "#1D4ED8", "#DC2626", "#15803D"], size: [6, 72, 12], sizeLabel: "fontSize" },
  stamp: { mode: ED.STAMP, label: "hlStamp", hint: "hintStamp" },
};
let currentTool = "select";
const toolPrefs = store.get("toolPrefs", {});

async function setTool(name) {
  if (!doc.pdf && name !== "select") return;
  currentTool = name;
  for (const b of document.querySelectorAll(".tool")) b.classList.toggle("on", b.dataset.tool === name);
  container.classList.toggle("hand", name === "hand");
  const def = TOOLS[name];
  const mode = def ? def.mode : ED.NONE;
  if (doc.pdf && viewer.annotationEditorMode !== mode && viewer.annotationEditorMode !== ED.DISABLE) {
    viewer.annotationEditorMode = { mode };
  }
  showToolOptions(name);
}

function showToolOptions(name) {
  const def = TOOLS[name];
  $("toolOptions").hidden = !def;
  if (!def) return;
  const prefs = (toolPrefs[name] ||= {});
  $("toolLabel").textContent = t(def.label);
  $("toolHint").textContent = t(def.hint);
  const sw = $("swatches");
  sw.replaceChildren();
  sw.hidden = !def.colors;
  if (def.colors) {
    const current = prefs.color || def.colors[0];
    for (const c of def.colors) {
      const b = document.createElement("button");
      b.className = "fl-swatch" + (c === current ? " on" : "");
      b.style.background = c;
      b.title = t("color") + " " + c;
      b.onclick = () => { prefs.color = c; store.set("toolPrefs", toolPrefs); applyToolParams(name); showToolOptions(name); };
      sw.append(b);
    }
  }
  const range = $("sizeRange");
  $("sizeWrap").hidden = !def.size;
  if (def.size) {
    [range.min, range.max] = def.size;
    range.value = prefs.size ?? def.size[2];
    $("sizeLabel").textContent = t(def.sizeLabel);
    range.oninput = () => { prefs.size = +range.value; store.set("toolPrefs", toolPrefs); applyToolParams(name, true); };
  }
  applyToolParams(name);
}

function applyToolParams(name, sizeOnly = false) {
  const def = TOOLS[name], prefs = toolPrefs[name] || {};
  if (!def?.colorParam) return;
  const dispatch = (type, value) => eventBus.dispatch("switchannotationeditorparams", { source: viewer, type, value });
  // wait a tick so the editor mode switch (async) has completed
  setTimeout(() => {
    if (!sizeOnly) dispatch(def.colorParam, prefs.color || def.colors[0]);
    dispatch(def.sizeParam, prefs.size ?? def.size[2]);
  }, 60);
}

for (const b of document.querySelectorAll(".tool")) {
  b.onclick = () => {
    const name = b.dataset.tool;
    if (name === "stamp") { $("imageInput").click(); return; }
    setTool(currentTool === name && TOOLS[name] ? "select" : name);
  };
}
$("btnToolDone").onclick = () => setTool("select");

// PDF.js may leave edit mode by itself (e.g. Escape); keep our buttons in sync.
eventBus.on("annotationeditormodechanged", ({ mode }) => {
  const name = Object.keys(TOOLS).find((k) => TOOLS[k].mode === mode) || (currentTool === "hand" ? "hand" : "select");
  if (name !== currentTool) { currentTool = name; for (const b of document.querySelectorAll(".tool")) b.classList.toggle("on", b.dataset.tool === name); showToolOptions(name); container.classList.toggle("hand", name === "hand"); }
});
eventBus.on("editingstateschanged", ({ details }) => {
  $("btnUndo").disabled = !details.hasSomethingToUndo;
  $("btnRedo").disabled = !details.hasSomethingToRedo;
});
$("btnUndo").disabled = $("btnRedo").disabled = true;
$("btnUndo").onclick = () => uiManager?.undo();
$("btnRedo").onclick = () => uiManager?.redo();

/** Adds an image (or signature) to the current page as a movable, resizable object. */
async function addImage(file) {
  if (!doc.pdf || !file) return;
  await setTool("stamp");
  await new Promise((r) => setTimeout(r, 80));
  const layer = uiManager?.currentLayer;
  if (!layer) return;
  await layer.pasteEditor({ mode: ED.STAMP }, { bitmapFile: file });
}
$("imageInput").onchange = (e) => { addImage(e.target.files[0]); e.target.value = ""; };

// Hand tool: drag to scroll
let drag = null;
container.addEventListener("pointerdown", (e) => {
  if (currentTool !== "hand" || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, left: container.scrollLeft, top: container.scrollTop };
  container.classList.add("grabbing");
  container.setPointerCapture(e.pointerId);
  e.preventDefault();
});
container.addEventListener("pointermove", (e) => {
  if (!drag) return;
  container.scrollLeft = drag.left - (e.clientX - drag.x);
  container.scrollTop = drag.top - (e.clientY - drag.y);
});
const endDrag = () => { drag = null; container.classList.remove("grabbing"); };
container.addEventListener("pointerup", endDrag);
container.addEventListener("pointercancel", endDrag);

// external links open in the system browser
container.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href]");
  if (!a || !/^(https?:|mailto:)/i.test(a.getAttribute("href"))) return;
  e.preventDefault();
  platform.openExternal(a.href);
}, true);

/* ================================================================== signature */

async function signDialog() {
  if (!doc.pdf) return;
  const saved = store.get("signatures", []);
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="tabs">
      <button type="button" data-tab="draw" class="on">${t("signDraw")}</button>
      <button type="button" data-tab="type">${t("signType")}</button>
      <button type="button" data-tab="saved">${t("signSaved")}</button>
    </div>
    <section data-pane="draw">
      <p class="muted small" style="margin:0 0 8px">${t("signDrawHint")}</p>
      <canvas class="sigpad" width="1000" height="360"></canvas>
      <div class="sigrow"><button type="button" class="btn secondary sm" data-clear>${t("clear")}</button>
      <label class="small"><input type="checkbox" data-remember checked> ${t("rememberSig")}</label></div>
    </section>
    <section data-pane="type" hidden>
      <input class="field" data-name placeholder="${t("typeName")}" autocomplete="name">
      <div class="sigtyped" data-preview></div>
    </section>
    <section data-pane="saved" hidden><div class="sigsaved"></div></section>`;
  const pad = body.querySelector("canvas");
  const ctx = pad.getContext("2d");
  ctx.lineCap = ctx.lineJoin = "round"; ctx.lineWidth = 5; ctx.strokeStyle = "#111";
  let drawing = false, dirty = false, last;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.onpointerdown = (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); };
  pad.onpointermove = (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; dirty = true;
  };
  pad.onpointerup = () => (drawing = false);
  body.querySelector("[data-clear]").onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; };
  const nameIn = body.querySelector("[data-name]"), preview = body.querySelector("[data-preview]");
  nameIn.oninput = () => (preview.textContent = nameIn.value);

  let tab = "draw";
  const showTab = (name) => {
    tab = name;
    for (const b of body.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === name);
    for (const s of body.querySelectorAll("[data-pane]")) s.hidden = s.dataset.pane !== name;
    if (name === "type") nameIn.focus();
  };
  for (const b of body.querySelectorAll("[data-tab]")) b.onclick = () => showTab(b.dataset.tab);

  let chosen = null;
  const renderSaved = () => {
    const box = body.querySelector(".sigsaved");
    box.replaceChildren();
    if (!saved.length) { box.innerHTML = `<p class="muted small">${t("noSavedSigs")}</p>`; return; }
    saved.forEach((url, i) => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<img alt=""><button type="button" class="del" aria-label="Delete">${icon("x", 12)}</button>`;
      item.querySelector("img").src = url;
      item.onclick = (e) => {
        if (e.target.closest(".del")) { saved.splice(i, 1); store.set("signatures", saved); renderSaved(); return; }
        chosen = url; $("dlg").close("place");
      };
      box.append(item);
    });
  };
  renderSaved();
  if (saved.length) showTab("saved");

  const result = await dialog({
    title: t("signTitle"), body,
    buttons: [{ label: t("cancel"), value: "cancel", kind: "secondary" }, { label: t("placeSig"), value: "place", kind: "primary" }],
  });
  if (result !== "place") return;

  let url = chosen;
  if (!url && tab === "draw" && dirty) {
    url = trimCanvas(pad).toDataURL("image/png");
    if (body.querySelector("[data-remember]").checked) { saved.unshift(url); store.set("signatures", saved.slice(0, 6)); }
  } else if (!url && tab === "type" && nameIn.value.trim()) {
    const c = document.createElement("canvas");
    const font = getComputedStyle(preview).fontFamily;
    const g = c.getContext("2d");
    g.font = `120px ${font}`;
    c.width = Math.ceil(g.measureText(nameIn.value).width) + 40; c.height = 180;
    g.font = `120px ${font}`; g.fillStyle = "#111"; g.textBaseline = "middle";
    g.fillText(nameIn.value, 20, 95);
    url = trimCanvas(c).toDataURL("image/png");
    saved.unshift(url); store.set("signatures", saved.slice(0, 6));
  }
  if (!url) return;
  const blob = await (await fetch(url)).blob();
  await addImage(new File([blob], "signature.png", { type: "image/png" }));
  toast(t("sigPlaced"), 5000);
}
$("btnSign").onclick = signDialog;

/** Crops transparent margins around a drawing. */
function trimCanvas(src) {
  const { width: w, height: h } = src;
  const data = src.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < x0) return src;
  const pad = 8, out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
  out.getContext("2d").drawImage(src, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ================================================================== find */

const findInput = $("findInput");
function openFind() {
  if (!doc.pdf) return;
  $("findPanel").hidden = false;
  const sel = getSelection()?.toString().trim();
  if (sel && sel.length < 80) findInput.value = sel;
  findInput.focus(); findInput.select();
  if (findInput.value) runFind("");
}
function closeFind() {
  $("findPanel").hidden = true;
  eventBus.dispatch("findbarclose", { source: null });
  container.focus();
}
function runFind(type, findPrevious = false) {
  eventBus.dispatch("find", {
    source: null, type, query: findInput.value,
    caseSensitive: $("findCase").checked, entireWord: $("findWords").checked,
    highlightAll: $("findAll").checked, matchDiacritics: $("findDiacritics").checked, findPrevious,
  });
}
let findTimer;
findInput.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(""), 200); });
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runFind("again", e.shiftKey); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
$("findNext").onclick = () => runFind("again");
$("findPrev").onclick = () => runFind("again", true);
$("findClose").onclick = closeFind;
$("btnFind").onclick = () => ($("findPanel").hidden ? openFind() : closeFind());
for (const [id, type] of [["findAll", "highlightallchange"], ["findCase", "casesensitivitychange"], ["findWords", "entirewordchange"], ["findDiacritics", "diacriticmatchingchange"]]) {
  $(id).onchange = () => runFind(type);
}
const showCount = ({ current, total }) => {
  $("findCount").textContent = !findInput.value ? "" : total ? (total > 1000 ? t("findMany", { total: 1000 }) : t("findOf", { n: current, total })) : t("findNone");
};
eventBus.on("updatefindmatchescount", ({ matchesCount }) => showCount(matchesCount));
eventBus.on("updatefindcontrolstate", ({ matchesCount }) => matchesCount && showCount(matchesCount));

/* ================================================================== sidebar: thumbnails & bookmarks */

const thumbs = (() => {
  const box = $("thumbs");
  let items = [], queue = [], busy = false, io = null, active = 0, token = 0;
  const WIDTH = 132;

  function reset() { io?.disconnect(); items = []; queue = []; box.replaceChildren(); token++; }

  async function build() {
    reset();
    const pdf = doc.pdf, my = token;
    const first = await pdf.getPage(1);
    const rot = viewer.pagesRotation;
    const vp = first.getViewport({ scale: 1, rotation: (first.rotate + rot) % 360 });
    const h = Math.round(WIDTH * vp.height / vp.width);
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const n = +e.target.dataset.page; if (!items[n - 1].done) queue.push(n); }
      pump(my);
    }, { root: box, rootMargin: "200px 0px" });
    for (let n = 1; n <= pdf.numPages; n++) {
      const b = document.createElement("button");
      b.className = "thumb"; b.dataset.page = n; b.title = t("printPage", { n, total: pdf.numPages });
      b.innerHTML = `<div class="tframe" style="width:${WIDTH}px;height:${h}px"></div><span>${n}</span>`;
      b.onclick = () => { viewer.currentPageNumber = n; };
      box.append(b);
      items.push({ el: b, done: false });
      io.observe(b);
    }
    setActive(viewer.currentPageNumber || 1);
  }

  async function pump(my) {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && my === token) {
        const n = queue.shift(), item = items[n - 1];
        if (!item || item.done) continue;
        item.done = true;
        const page = await doc.pdf.getPage(n);
        if (my !== token) return;
        const vp0 = page.getViewport({ scale: 1, rotation: (page.rotate + viewer.pagesRotation) % 360 });
        const scale = WIDTH / vp0.width, dpr = Math.min(2, devicePixelRatio || 1);
        const vp = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + viewer.pagesRotation) % 360 });
        const c = document.createElement("canvas");
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.width = WIDTH + "px"; c.style.height = Math.round(vp.height / dpr) + "px";
        await page.render({ canvas: c, viewport: vp, annotationMode: AnnotationMode.ENABLE_FORMS }).promise.catch(() => {});
        if (my !== token) return;
        const frame = item.el.querySelector(".tframe");
        frame.style.height = c.style.height;
        frame.replaceChildren(c);
      }
    } finally { busy = false; }
  }

  function setActive(n) {
    items[active - 1]?.el.classList.remove("on");
    active = n;
    const it = items[n - 1];
    if (!it) return;
    it.el.classList.add("on");
    if (!$("sidebar").hidden && !box.hidden) it.el.scrollIntoView({ block: "nearest" });
  }

  return { build, reset, setActive, rerender: () => doc.pdf && build() };
})();
function buildThumbnails() { thumbs.build(); }

async function buildOutline() {
  const box = $("outline");
  const outline = await doc.pdf.getOutline().catch(() => null);
  if (!outline?.length) { box.innerHTML = `<p class="empty">${t("noBookmarks")}</p>`; return; }
  const build = (list) => {
    const ul = document.createElement("ul");
    for (const it of list) {
      const li = document.createElement("li"), a = document.createElement("a");
      a.href = "#"; a.textContent = it.title || "—";
      if (it.bold) a.style.fontWeight = "600";
      if (it.italic) a.style.fontStyle = "italic";
      a.onclick = (e) => {
        e.preventDefault();
        if (it.url) platform.openExternal(it.url);
        else if (it.dest) linkService.goToDestination(it.dest);
      };
      li.append(a);
      if (it.items?.length) li.append(build(it.items));
      ul.append(li);
    }
    return ul;
  };
  box.replaceChildren(build(outline));
}

function showPanel(name) {
  for (const b of document.querySelectorAll("[data-panel]")) b.classList.toggle("on", b.dataset.panel === name);
  $("thumbs").hidden = name !== "thumbs";
  $("outline").hidden = name !== "outline";
  $("panelTitle").textContent = t(name === "thumbs" ? "thumbnails" : "bookmarks");
  store.set("panel", name);
}
for (const b of document.querySelectorAll("[data-panel]")) b.onclick = () => showPanel(b.dataset.panel);
function toggleSidebar(force) {
  const show = force ?? $("sidebar").hidden;
  $("sidebar").hidden = !show;
  $("btnSidebar").classList.toggle("on", show);
  store.set("sidebar", show);
  if (show) thumbs.setActive(viewer.currentPageNumber);
}
$("btnSidebar").onclick = () => toggleSidebar();
showPanel(store.get("panel", "thumbs"));
toggleSidebar(store.get("sidebar", innerWidth > 900));

/* ================================================================== print */

async function printDocument() {
  if (!doc.pdf) return;
  const pdf = doc.pdf, total = pdf.numPages;
  const overlay = document.createElement("div");
  overlay.className = "progress";
  overlay.innerHTML = `<div><b>${t("printing")}</b><div class="small muted" data-s></div><progress max="${total}" value="0"></progress></div>`;
  document.body.append(overlay);
  const out = $("printContainer");
  out.replaceChildren();
  const urls = [];
  try {
    const printStorage = pdf.annotationStorage.print;
    for (let n = 1; n <= total; n++) {
      overlay.querySelector("[data-s]").textContent = t("printPage", { n, total });
      overlay.querySelector("progress").value = n - 1;
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 150 / 72, rotation: (page.rotate + viewer.pagesRotation) % 360 });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, viewport: vp, intent: "print", annotationMode: AnnotationMode.ENABLE_STORAGE, printAnnotationStorage: printStorage }).promise;
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
      const url = URL.createObjectURL(blob); urls.push(url);
      const img = new Image(); img.src = url; await img.decode().catch(() => {});
      out.append(img);
      c.width = c.height = 0;
    }
  } catch (e) {
    toast(t("failed", { err: e?.message || e }));
    overlay.remove(); out.replaceChildren(); urls.forEach(URL.revokeObjectURL); return;
  }
  overlay.remove();
  const cleanup = () => { out.replaceChildren(); urls.forEach(URL.revokeObjectURL); };
  addEventListener("afterprint", cleanup, { once: true });
  await platform.print();
  setTimeout(() => { if (out.childElementCount) cleanup(); }, 120_000);
}
$("btnPrint").onclick = printDocument;

/* ================================================================== presentation */

let presentState = null;
async function present(on = !presentState) {
  if (!doc.pdf) return;
  if (on) {
    presentState = { scale: viewer.currentScaleValue, scroll: viewer.scrollMode, spread: viewer.spreadMode, page: viewer.currentPageNumber, tool: currentTool };
    setTool("select");
    document.body.classList.add("presenting");
    await platform.setFullscreen(true);
    viewer.scrollMode = ScrollMode.PAGE; viewer.spreadMode = SpreadMode.NONE;
    setTimeout(() => { viewer.currentScaleValue = "page-fit"; viewer.currentPageNumber = presentState.page; }, 150);
  } else {
    const s = presentState; presentState = null;
    document.body.classList.remove("presenting");
    await platform.setFullscreen(false);
    viewer.scrollMode = s.scroll; viewer.spreadMode = s.spread;
    setTimeout(() => { viewer.currentScaleValue = s.scale; }, 150);
  }
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && presentState && !platform.isDesktop) present(false); });
container.addEventListener("click", (e) => {
  if (!presentState || e.target.closest("a, .annotationLayer section")) return;
  e.clientX < innerWidth / 3 ? viewer.previousPage() : viewer.nextPage();
});

/* ================================================================== read aloud */

const speech = "speechSynthesis" in window ? window.speechSynthesis : null;
let reading = null;
if (!speech) $("miRead").hidden = true;

async function readAloud(page = viewer.currentPageNumber) {
  if (!speech || !doc.pdf) { toast(t("noSpeech")); return; }
  stopReading();
  const my = (reading = { page, paused: false });
  $("readBar").hidden = false;
  for (let n = page; n <= doc.pdf.numPages && reading === my; n++) {
    const p = await doc.pdf.getPage(n);
    const text = (await p.getTextContent()).items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("").replace(/\s+/g, " ").trim();
    if (reading !== my) return;
    viewer.currentPageNumber = n;
    if (!text) { if (n === page) toast(t("noText")); continue; }
    await speak(text, my);
  }
  if (reading === my) stopReading();
}
function speak(text, my) {
  // speak sentence by sentence: long utterances are cut off by some engines
  const parts = text.match(/[^.!?;·\n]+[.!?;·]*\s*/g) || [text];
  const lang = /[Ͱ-Ͽἀ-῿]/.test(text) ? "el-GR" : LANG === "el" ? "el-GR" : "en-US";
  const voice = speech.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (reading !== my || i >= parts.length) return resolve();
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = lang; if (voice) u.voice = voice;
      u.onend = next; u.onerror = () => resolve();
      speech.speak(u);
    };
    next();
  });
}
function stopReading() {
  if (!reading) return;
  reading = null;
  speech?.cancel();
  $("readBar").hidden = true;
}
$("readStop").onclick = stopReading;
$("readPause").onclick = () => {
  if (!reading) return;
  reading.paused = !reading.paused;
  reading.paused ? speech.pause() : speech.resume();
  $("readPause").innerHTML = icon(reading.paused ? "play" : "pause");
};

/* ================================================================== properties, shortcuts, about */

async function showProperties() {
  if (!doc.pdf) return;
  const { info, metadata } = await doc.pdf.getMetadata().catch(() => ({ info: {} }));
  const page = await doc.pdf.getPage(1);
  const [x0, y0, x1, y1] = page.view;
  const rot = page.rotate % 180 !== 0;
  const wPt = rot ? y1 - y0 : x1 - x0, hPt = rot ? x1 - x0 : y1 - y0;
  const mm = (pt) => Math.round(pt * 25.4 / 72), inch = (pt) => (pt / 72).toFixed(2);
  const sizes = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [216, 279], Legal: [216, 356] };
  const named = Object.entries(sizes).find(([, [a, b]]) => (Math.abs(mm(wPt) - a) <= 2 && Math.abs(mm(hPt) - b) <= 2) || (Math.abs(mm(wPt) - b) <= 2 && Math.abs(mm(hPt) - a) <= 2))?.[0];
  const date = (s) => { const d = s && PDFDateString.toDateObject(s); return d ? d.toLocaleString(LANG === "el" ? "el-GR" : undefined) : ""; };
  const sizeStr = (b) => b > 1048576 ? (b / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const rows = [
    ["pFile", doc.name], ["pSize", `${sizeStr(doc.size)} (${doc.size.toLocaleString()} bytes)`],
    ["pTitle", metadata?.get?.("dc:title") || info.Title], ["pAuthor", metadata?.get?.("dc:creator")?.join?.(", ") || info.Author],
    ["pSubject", info.Subject], ["pKeywords", info.Keywords], ["pCreated", date(info.CreationDate)], ["pModified", date(info.ModDate)],
    ["pCreator", info.Creator], ["pProducer", info.Producer], ["pVersion", info.PDFFormatVersion],
    ["pPages", doc.pdf.numPages], ["pPageSize", `${mm(wPt)} × ${mm(hPt)} mm (${inch(wPt)} × ${inch(hPt)} in)${named ? " · " + named : ""}`],
  ];
  const dl = document.createElement("dl");
  dl.className = "props";
  for (const [k, v] of rows) {
    if (v === undefined || v === null || v === "") continue;
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = t(k); dd.textContent = v;
    dl.append(dt, dd);
  }
  dialog({ title: t("properties"), body: dl, buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] });
}

function showShortcuts() {
  const mac = /Mac/.test(navigator.platform), c = mac ? "⌘" : "Ctrl+", s = mac ? "⇧" : "Shift+";
  const rows = [
    ["kOpen", c + "O"], ["kSave", c + "S"], ["kSaveAs", c + s + "S"], ["kPrint", c + "P"], ["kFind", c + "F"],
    ["kSidebar", "F4"], ["kZoom", `${c}+ / ${c}−`], ["kActual", c + "1"], ["kFitPage", c + "0"], ["kFitWidth", c + "2"],
    ["kRotate", `${c}${s}+ / ${c}${s}−`], ["kNav", "→ / ←"], ["kFirstLast", "Home / End"], ["kPresent", c + "L"],
    ["kSelect", "V"], ["kHand", "H"], ["kUndo", `${c}Z / ${c}Y`], ["kNight", "N"], ["kProps", c + "D"], ["kRead", c + s + "Y"], ["kHelp", "?"],
  ];
  const box = document.createElement("div");
  box.className = "keys";
  for (const [k, key] of rows) {
    const a = document.createElement("span"), b = document.createElement("kbd");
    a.textContent = t(k); b.textContent = key;
    box.append(a, b);
  }
  dialog({ title: t("shortcuts"), body: box, buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] });
}

function showAbout() {
  const p = document.createElement("p");
  p.style.whiteSpace = "pre-line"; p.style.margin = "0";
  p.textContent = t("aboutBody", { v: VERSION });
  dialog({ title: t("about"), body: p, buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] });
}

/* ================================================================== night mode */

function setNight(on) {
  document.body.classList.toggle("night", on);
  document.querySelector('[data-act="night"]').setAttribute("aria-checked", on);
  store.set("night", on);
}
setNight(store.get("night", false));

/* ================================================================== "more" menu */

const menu = $("moreMenu");
function openMenu() {
  const r = $("btnMore").getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = r.bottom + 6 + "px";
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
  menu.querySelector("button:not([hidden])")?.focus();
}
const closeMenu = () => (menu.hidden = true);
$("btnMore").onclick = (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); };
addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !$("btnMore").contains(e.target)) closeMenu(); });
menu.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  closeMenu();
  ({
    saveAs: () => save({ as: true }),
    rotateCw: () => rotate(90), rotateCcw: () => rotate(-90),
    layout: () => applyLayout(b.dataset.v),
    present: () => present(true),
    readAloud: () => readAloud(),
    night: () => setNight(!document.body.classList.contains("night")),
    properties: showProperties, shortcuts: showShortcuts, about: showAbout,
  })[b.dataset.act]?.();
});
menu.addEventListener("keydown", (e) => {
  const items = [...menu.querySelectorAll("button")].filter((b) => b.offsetParent);
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === "Escape") { closeMenu(); $("btnMore").focus(); }
});

/* ================================================================== keyboard */

addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  const typing = e.target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
  if ($("dlg").open) return;

  if (mod && key === "o") { e.preventDefault(); openPicker(); return; }
  if (!doc.pdf) return;
  if (mod && key === "s") { e.preventDefault(); save({ as: e.shiftKey }); return; }
  if (mod && key === "p") { e.preventDefault(); printDocument(); return; }
  if (mod && key === "f") { e.preventDefault(); openFind(); return; }
  if (mod && key === "l") { e.preventDefault(); present(); return; }
  if (mod && key === "d") { e.preventDefault(); showProperties(); return; }
  if (mod && e.shiftKey && key === "y") { e.preventDefault(); reading ? stopReading() : readAloud(); return; }
  if (mod && e.shiftKey && (e.key === "+" || e.key === "=")) { e.preventDefault(); rotate(90); return; }
  if (mod && e.shiftKey && (e.key === "-" || e.key === "_")) { e.preventDefault(); rotate(-90); return; }
  if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); viewer.increaseScale(); return; }
  if (mod && e.key === "-") { e.preventDefault(); viewer.decreaseScale(); return; }
  if (mod && e.key === "0") { e.preventDefault(); viewer.currentScaleValue = "page-fit"; return; }
  if (mod && e.key === "1") { e.preventDefault(); viewer.currentScaleValue = "page-actual"; return; }
  if (mod && e.key === "2") { e.preventDefault(); viewer.currentScaleValue = "page-width"; return; }
  if (e.key === "F4") { e.preventDefault(); toggleSidebar(); return; }
  if (e.key === "Escape") {
    if (presentState) { present(false); return; }
    if (!$("findPanel").hidden) { closeFind(); return; }
    if (reading) { stopReading(); return; }
    if (currentTool !== "select" && currentTool !== "hand" && !uiManager?.hasSelection) { setTool("select"); return; }
    return;
  }
  if (typing || mod || e.altKey) return;
  const editing = viewer.annotationEditorMode > 0 && uiManager?.hasSelection;
  if (editing) return;
  switch (e.key) {
    case "ArrowRight": case "PageDown": case " ":
      if (presentState || e.key === "ArrowRight") { e.preventDefault(); viewer.nextPage(); } break;
    case "ArrowLeft": case "PageUp":
      if (presentState || e.key === "ArrowLeft") { e.preventDefault(); viewer.previousPage(); } break;
    case "Home": if (document.activeElement !== container) { e.preventDefault(); viewer.currentPageNumber = 1; } break;
    case "End": if (document.activeElement !== container) { e.preventDefault(); viewer.currentPageNumber = viewer.pagesCount; } break;
    case "v": case "V": setTool("select"); break;
    case "h": case "H": setTool("hand"); break;
    case "n": case "N": setNight(!document.body.classList.contains("night")); break;
    case "?": showShortcuts(); break;
  }
});

/* ================================================================== drag & drop, paste */

let dragDepth = 0;
addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; $("dropHint").hidden = false; } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropHint").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("dropHint").hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.type.startsWith("image/") && doc.pdf) addImage(f); else openFile(f);
});
addEventListener("paste", (e) => {
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type === "application/pdf");
  if (f) { e.preventDefault(); openFile(f); }
});
if ("launchQueue" in window) launchQueue.setConsumer(async (p) => { const h = p.files?.[0]; if (h) openFile(await h.getFile()); });

/* ================================================================== small UI helpers */

function text(s) { const p = document.createElement("p"); p.style.margin = "0"; p.textContent = s; return p; }

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/** Modal dialog. Resolves to the value of the button pressed ("cancel" on Esc / ✕). */
function dialog({ title, body, buttons = [] }) {
  const dlg = $("dlg");
  if (dlg.open) dlg.close("cancel");
  $("dlgTitle").textContent = title;
  $("dlgBody").replaceChildren(body);
  $("dlgFoot").replaceChildren(...buttons.map((b) => {
    const btn = document.createElement("button");
    btn.className = `btn ${b.kind || "secondary"}`;
    btn.value = b.value; btn.textContent = b.label;
    if (b.value === "cancel") btn.formNoValidate = true;
    return btn;
  }));
  dlg.returnValue = "cancel";
  dlg.showModal();
  const primary = $("dlgFoot").querySelector(".primary");
  const firstInput = body.querySelector?.("input:not([type=checkbox])");
  (firstInput || primary)?.focus();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue || "cancel"), { once: true }));
}

async function askPassword(name, wrong) {
  const box = document.createElement("div");
  box.append(text(wrong ? t("passwordWrong") : t("passwordBody", { name })));
  const input = Object.assign(document.createElement("input"), { type: "password", className: "field", placeholder: t("password") });
  input.style.marginTop = "12px";
  input.autocomplete = "off";
  box.append(input);
  const r = await dialog({ title: t("passwordTitle"), body: box, buttons: [{ label: t("cancel"), value: "cancel" }, { label: t("ok"), value: "ok", kind: "primary" }] });
  return r === "ok" ? input.value : null;
}

// rich tooltips (label + keyboard shortcut)
const tip = $("tooltip");
let tipTimer;
document.addEventListener("pointerover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  clearTimeout(tipTimer); tip.hidden = true;
  if (!el || e.pointerType === "touch") return;
  tipTimer = setTimeout(() => {
    if (!el.isConnected || !el.matches(":hover")) return;
    tip.innerHTML = "";
    tip.append(t(el.dataset.tip));
    const k = shortcut(el.dataset.tip);
    if (k) { const kb = document.createElement("kbd"); kb.textContent = k; tip.append(kb); }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 8 + tip.offsetHeight > innerHeight ? r.top - tip.offsetHeight - 8 : r.bottom + 8;
    tip.style.top = top + "px";
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + "px";
  }, 450);
});
document.addEventListener("pointerdown", () => { clearTimeout(tipTimer); tip.hidden = true; });

// offline support for the web version
if (!platform.isDesktop && "serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// handy for debugging from the console
window.flipleaf = { viewer, eventBus, doc, get uiManager() { return uiManager; } };
