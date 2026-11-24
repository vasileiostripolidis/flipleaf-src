// Flipleaf — a feather-light PDF reader.
// Rendering, forms, links, find and annotation editing come from Mozilla PDF.js (Apache-2.0).
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
import { hydrateIcons, icon } from "./icons.js";
import { t, shortcut, translateDom, LANG } from "./i18n.js";
import * as platform from "./platform.js";
import { createEditor } from "./editor.js";
import { createSearch } from "./search.js";
import { installPro } from "./pro.js";
import { createSignatureStudio, urlToFile } from "./signature.js";

globalThis.pdfjsLib = pdfjsLib; // the viewer components expect it here
const { EventBus, PDFViewer, PDFLinkService, ScrollMode, SpreadMode, LinkTarget } =
  await import("./vendor/pdfjs/web/pdf_viewer.mjs");
const { AnnotationEditorType: ED, AnnotationEditorParamsType: EP, AnnotationMode, PDFDateString } = pdfjsLib;

const VERSION = "1.17.2";
const BASE = new URL("./vendor/pdfjs/", import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + "pdf.worker.min.mjs";
const LOAD_OPTIONS = {
  cMapUrl: BASE + "cmaps/",
  cMapPacked: true,
  standardFontDataUrl: BASE + "standard_fonts/",
  wasmUrl: BASE + "wasm/",
  iccUrl: BASE + "iccs/",
  isEvalSupported: false,
  enableXfa: true,
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMac = /Mac/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+", shift = isMac ? "⇧" : "Shift+";
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
const viewer = new PDFViewer({
  container,
  viewer: $("viewer"),
  eventBus,
  linkService,
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

const doc = { pdf: null, task: null, name: "", path: null, size: 0, dirty: false, key: "", password: undefined };

/* ------------------------------------------------------------------ tabs */
// Every open document is a tab. The visible tab lives in `doc` and the viewer; the others keep
// their bytes (changes included), password and view, and are reloaded when they are selected.
const tabs = [];
let active = null;
let tabSeq = 0;
let pendingView = null;
const tabDirty = (tab) => (tab === active ? doc.dirty : tab.dirty);
// tab operations run one at a time (e.g. several files dropped at once)
let tabQueue = Promise.resolve();
const serial = (fn) => (...a) => (tabQueue = tabQueue.then(() => fn(...a)).catch((e) => { toast(t("failed", { err: e?.message || e })); return false; }));

/** Opens a document in a new tab (or selects the tab that already shows that file). */
const openData = serial(async ({ name, data, path }, { dirty = false } = {}) => {
  const same = path && tabs.find((x) => (x === active ? doc.path : x.path) === path);
  if (same) return selectTabNow(same);
  const prev = active;
  await stashActive();
  const tab = { id: ++tabSeq, name, path, dirty };
  tabs.splice(prev ? tabs.indexOf(prev) + 1 : tabs.length, 0, tab);
  active = tab;
  if (await loadDoc({ name, data, path }, { dirty })) return true;
  // could not open (wrong file, password cancelled): go back to where we were
  tabs.splice(tabs.indexOf(tab), 1);
  active = null;
  if (prev) await selectTabNow(prev); else showHome();
  return false;
});

/** Keeps the visible tab's current state and empties the viewer. */
async function stashActive() {
  if (!active || !doc.pdf) return;
  if (editor.active) await editor.exit(true);
  closeFind();
  const dirty = doc.dirty;
  const bytes = dirty ? await documentBytes() : await doc.pdf.getData();
  const v = viewer.currentScaleValue;
  Object.assign(active, {
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), name: doc.name, path: doc.path,
    password: doc.password, saveDir: doc.saveDir, dirty, view: { page: viewer.currentPageNumber, scale: isNaN(+v) ? v : +v, rotation: viewer.pagesRotation },
  });
  rememberView();
  await closeDocument();
}

async function selectTabNow(tab) {
  if (tab === active || !tabs.includes(tab)) return true;
  await stashActive();
  active = tab;
  const data = tab.data; tab.data = null;
  pendingView = tab.view || null;
  const ok = await loadDoc({ name: tab.name, data, path: tab.path, password: tab.password }, { dirty: tab.dirty });
  if (ok) doc.saveDir = tab.saveDir || null;
  if (!ok) { tab.data = data; renderTabs(); }
  return ok;
}
const selectTab = serial(selectTabNow);

/** Closes one tab, asking to save its changes first. Resolves false when cancelled. */
async function closeTabNow(tab = active) {
  if (!tab) return true;
  if (tab !== active && tab.dirty && !(await selectTabNow(tab))) return false;
  if (tab === active) {
    if (!(await confirmDiscard())) return false;
    if (editor.active) await editor.exit(false);
    await closeDocument();
    active = null;
  }
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (active) { renderTabs(); return true; }
  const next = tabs[Math.min(i, tabs.length - 1)];
  if (next) await selectTabNow(next); else showHome();
  return true;
}
const closeTab = serial(closeTabNow);

function showHome() {
  $("launching")?.remove();
  document.body.classList.add("no-doc");
  $("home").hidden = false;
  $("docTitle").textContent = "Flipleaf";
  setDirty(false);
  renderTabs();
  refreshRecent();
}

function cycleTab(step) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(active);
  selectTab(tabs[(i + step + tabs.length) % tabs.length]);
}

function renderTabs() {
  const bar = $("tabbar");
  bar.replaceChildren(...tabs.map((tab) => {
    const el = document.createElement("div");
    el.className = "tab" + (tab === active ? " on" : "");
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", tab === active);
    el.tabIndex = tab === active ? 0 : -1;
    const name = tab === active ? doc.name || tab.name : tab.name;
    el.title = (tab === active ? doc.path : tab.path) || name;
    el.innerHTML = icon("file-text", 15) + `<span class="tname"></span><span class="tdirty"${tabDirty(tab) ? "" : " hidden"}></span><button class="tclose" tabindex="-1">${icon("x", 14)}</button>`;
    el.querySelector(".tname").textContent = name;
    const x = el.querySelector(".tclose");
    x.title = t("closeTab"); x.setAttribute("aria-label", t("closeTab"));
    x.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
    el.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); };
    el.onauxclick = (e) => { if (e.button === 1) closeTab(tab); };
    el.onclick = () => selectTab(tab);
    return el;
  }), Object.assign(document.createElement("button"), { className: "btn icon sm tadd", innerHTML: icon("plus", 16), title: t("newTab"), onclick: openPicker }));
  bar.querySelector(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function loadDoc({ name, data, path, password }, { dirty = false } = {}) {
  const size = data.byteLength; // PDF.js takes ownership of `data`
  if (editor.active) await editor.exit(false);
  await closeDocument();
  doc.password = password;
  const loadingTask = pdfjsLib.getDocument({ data, ...LOAD_OPTIONS, password });
  doc.task = loadingTask;
  loadingTask.onPassword = async (update, reason) => {
    const pw = await askPassword(name, reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    if (pw === null) loadingTask.destroy(); else { doc.password = pw; update(pw); }
  };
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    if (doc.task === loadingTask && e?.name !== "AbortException" && !/destroyed/i.test(e?.message)) {
      toast(e?.name === "InvalidPDFException" ? t("invalid") : t("failed", { err: e?.message || e }));
    }
    return false;
  }
  if (doc.task !== loadingTask) { pdf.destroy(); return false; }

  Object.assign(doc, { pdf, name, path, size, dirty: false, saveDir: null, key: pdf.fingerprints[0] });
  pdf.annotationStorage.onSetModified = () => setDirty(true);

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
  $("pageInput").value = 1; // the view restore below moves it if needed

  thumbs.build();
  search.reset(doc.pdf);
  // read the text for "Find" in the background, so the first search is instant too
  { const p = doc.pdf; setTimeout(() => { if (doc.pdf === p && p.numPages <= 1500) search.warm(); }, 1200); }
  buildOutline();
  if (dirty) setDirty(true);
  if (!password) pdf.getFieldObjects().then((f) => { if (f && Object.keys(f).length) toast(t("forms"), 5000); }).catch(() => {});
  renderTabs();
  $("launching")?.remove();
  container.focus();
  return true;
}

async function closeDocument() {
  stopReading();
  search.reset(null);
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
  renderTabs();
}

// restore page, zoom and layout per document
eventBus.on("pagesinit", () => {
  const saved = pendingView || store.get("view." + doc.key, null);
  pendingView = null;
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
$("btnScanHome").onclick = () => pro.scan();
// Files the OS asks us to open wait until the license agreement has been answered: a password
// prompt must never replace the license dialog (that would count as "Decline" and quit).
let licenseAnswered;
const licenseGate = new Promise((done) => (licenseAnswered = done));
const startFiles = platform.onOpenRequest((path) => licenseGate.then(() => openPath(path))).catch(() => 0);

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
    // the folder, cut at the start when it is too long so its end stays visible
    const folder = path.replace(/^\\\\\?\\(UNC\\)?/, (m, unc) => (unc ? "\\\\" : "")).replace(/[\\/][^\\/]*$/, "").replace(/^([A-Za-z]:)$/, "$1\\") || path;
    b.querySelector(".path").textContent = "\u200e" + folder + "\u200e";
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
  if (editor.active) await editor.exit(true);
  try {
    const bytes = await documentBytes();
    let where;
    if (!as && doc.path && platform.isDesktop) where = await platform.saveToPath(bytes, doc.path);
    else where = await platform.saveAs(bytes, suggestedName(), doc.saveDir);
    if (!where) return false; // cancelled
    doc.saveDir = null;
    if (where !== "download") { doc.path = where; doc.name = where.split(/[\\/]/).pop(); $("docTitle").textContent = doc.name; }
    doc.pdf.annotationStorage.resetModified();
    setDirty(false);
    toast(t("saved"));
    refreshRecent();
    return true;
  } catch (e) {
    toast(t("saveFailed", { err: e?.message || e }), 6000);
    return false;
  }
}
$("btnSave").onclick = () => save();

/**
 * After "Reduce file size": by default the result becomes a new file, "<name>_compressed.pdf", so the
 * original is not overwritten. Saving asks where to put it, starting in the original's folder.
 */
function renameCompressed() {
  if (!store.get("compressRename", true)) return;
  const suffix = store.get("compressSuffix", "_compressed") || "_compressed";
  const m = doc.name.match(/^(.*?)(\.[^.]+)?$/), base = m[1] || "document", ext = m[2] || ".pdf";
  if (base.endsWith(suffix)) return;
  if (doc.path) doc.saveDir = doc.path.replace(/[\\/][^\\/]*$/, "") || null;
  doc.path = null;
  doc.name = base + suffix + ext;
  $("docTitle").textContent = doc.name;
  updateTitle();
}

/* ------------------------------------------------------------------ settings */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function openSettings() {
  const rename = store.get("compressRename", true), suffix = store.get("compressSuffix", "_compressed");
  const body = document.createElement("div");
  body.className = "settings";
  const sel = (key, value, opts) => `<select class="field" data-k="${key}">${opts.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  body.innerHTML = `
    <section><h3>${esc(t("setCompress"))}</h3>
      <label class="check-row"><input type="checkbox" data-k="compressRename"${rename ? " checked" : ""}><span>${esc(t("setCompressRename"))}</span></label>
      <label class="frow"><span>${esc(t("setSuffix"))}</span><input class="field" data-k="compressSuffix" value="${esc(suffix)}" maxlength="40" spellcheck="false"></label>
      <p class="hint" data-k="example"></p></section>
    <section><h3>${esc(t("setPhotos"))}</h3>
      <label class="frow"><span>${esc(t("setPhotoInsert"))}</span>${sel("imageScan", store.get("imageScan", "ask"), [["ask", t("setAsk")], ["scan", t("imgScan")], ["asis", t("imgAsIs")]])}</label></section>
    <section><h3>${esc(t("setLook"))}</h3>
      <label class="frow"><span>${esc(t("theme"))}</span>${sel("theme", store.get("theme", "system"), [["system", t("themeSystem")], ["light", t("themeLight")], ["dark", t("themeDark")]])}</label>
      <label class="frow"><span>${esc(t("language"))}</span>${sel("lang", store.get("lang", "system"), [["system", t("langSystem")], ["en", "English"], ["el", "Ελληνικά"]])}</label></section>
    ${platform.isDesktop ? `<section><h3>${esc(t("setApp"))}</h3>
      <label class="check-row"><input type="checkbox" data-k="askCloseAll"${store.get("askCloseAll", true) ? " checked" : ""}><span>${esc(t("askCloseAll"))}</span></label>
      ${updateChannel === "direct" ? `<label class="check-row"><input type="checkbox" data-k="autoUpdate"${store.get("autoUpdate", true) ? " checked" : ""}><span>${esc(t("autoUpdates"))}</span></label>` : ""}</section>` : ""}`;
  const q = (k) => body.querySelector(`[data-k="${k}"]`);
  // the open document's name without the extension and without an earlier suffix
  let exampleBase = doc.pdf ? doc.name.replace(/\.[^.]+$/, "") : t("setExampleDoc");
  if (suffix && exampleBase.endsWith(suffix)) exampleBase = exampleBase.slice(0, -suffix.length) || exampleBase;
  const example = () => {
    const s = q("compressSuffix").value.replace(/[\\/:*?"<>|]/g, "") || "_compressed";
    q("example").textContent = t("setExample", { name: exampleBase + s + ".pdf" });
    q("compressSuffix").disabled = !q("compressRename").checked;
  };
  q("compressSuffix").oninput = example; q("compressRename").onchange = example; example();
  dialog({ title: t("settingsTitle"), body, buttons: [{ label: t("cancel"), value: "cancel", kind: "secondary" }, { label: t("save"), value: "ok", kind: "primary" }] }).then((v) => {
    if (v !== "ok") return;
    store.set("compressRename", q("compressRename").checked);
    store.set("compressSuffix", q("compressSuffix").value.replace(/[\\/:*?"<>|]/g, "").trim() || "_compressed");
    store.set("imageScan", q("imageScan").value);
    if (q("askCloseAll")) store.set("askCloseAll", q("askCloseAll").checked);
    if (q("autoUpdate")) store.set("autoUpdate", q("autoUpdate").checked);
    setTheme(q("theme").value);
    setLanguage(q("lang").value); // reloads the window when the language changes
    toast(t("setSaved"));
  });
}

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
/** Closing the window: with several tabs, asks once (unless turned off), then asks to save each unsaved one. */
const closeGuard = serial(async () => {
  if (tabs.length > 1 && store.get("askCloseAll", true)) {
    const body = document.createElement("div");
    body.className = "closeall";
    body.append(text(t("closeAllBody", { n: tabs.length })));
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox"><span></span>`;
    label.querySelector("span").textContent = t("dontAskAgain");
    body.append(label);
    const choice = await dialog({
      title: t("closeAllTitle"),
      body,
      buttons: [{ label: t("cancel"), value: "cancel", kind: "secondary" }, { label: t("closeAll"), value: "ok", kind: "primary" }],
    });
    if (choice !== "ok") return false;
    if (label.querySelector("input").checked) store.set("askCloseAll", false);
  }
  for (const tab of [...tabs]) {
    if (!tabDirty(tab)) continue;
    if (!(await selectTabNow(tab)) || !(await confirmDiscard())) return false;
  }
  return true;
});
closeGuard.isDirty = () => tabs.some(tabDirty);
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
// room at the end of each choice, so the longest one doesn't touch the edge of the open list
for (const o of zoomSelect.options) if (o.id !== "zoomCustom") o.textContent = o.textContent.trim() + "\u2003\u2003";
eventBus.on("scalechanging", ({ scale, presetValue }) => {
  const custom = $("zoomCustom");
  const preset = presetValue || [...zoomSelect.options].find((o) => o.value !== "custom" && Math.abs(+o.value - scale) < 1e-3)?.value;
  if (preset) { zoomSelect.value = preset; custom.hidden = true; }
  else { custom.textContent = Math.round(scale * 100) + "%"; custom.hidden = false; zoomSelect.value = "custom"; }
  if (presetValue) store.set("zoom", presetValue);
  fitZoomWidth();
});
// The zoom box grows/shrinks so the chosen option is always fully visible.
const measureCtx = document.createElement("canvas").getContext("2d");
function fitZoomWidth() {
  const opt = zoomSelect.options[zoomSelect.selectedIndex];
  if (!opt) return;
  const cs = getComputedStyle(zoomSelect);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const label = measureCtx.measureText(opt.textContent.trim()).width;
  const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + 26; // + dropdown arrow
  zoomSelect.style.width = Math.ceil(label + chrome) + "px";
}
fitZoomWidth();
document.fonts?.ready.then(fitZoomWidth);
zoomSelect.onchange = () => { if (zoomSelect.value !== "custom") viewer.currentScaleValue = zoomSelect.value; fitZoomWidth(); container.focus(); };
$("btnZoomIn").onclick = () => viewer.increaseScale();
$("btnZoomOut").onclick = () => viewer.decreaseScale();
container.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !doc.pdf) return;
  e.preventDefault();
  const opts = { drawingDelay: 300, scaleFactor: Math.exp(-e.deltaY / 300) };
  if (e.deltaY < 0) viewer.increaseScale(opts); else viewer.decreaseScale(opts);
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
let currentLayout = "scroll";
function applyLayout(name, persist = true) {
  const [scroll, spread] = LAYOUTS[name] || LAYOUTS.scroll;
  viewer.scrollMode = scroll;
  viewer.spreadMode = spread;
  currentLayout = name;
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
  markTool(name);
  const mode = TOOLS[name]?.mode ?? ED.NONE;
  if (doc.pdf && viewer.annotationEditorMode !== mode && viewer.annotationEditorMode !== ED.DISABLE) {
    viewer.annotationEditorMode = { mode };
  }
  showToolOptions(name);
}

function markTool(name) {
  currentTool = name;
  for (const b of document.querySelectorAll(".tool")) b.classList.toggle("on", b.dataset.tool === name);
  container.classList.toggle("hand", name === "hand");
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
  if (name !== currentTool) { markTool(name); showToolOptions(name); }
});
eventBus.on("editingstateschanged", ({ details }) => {
  $("btnUndo").disabled = !details.hasSomethingToUndo;
  $("btnRedo").disabled = !details.hasSomethingToRedo;
});
$("btnUndo").disabled = $("btnRedo").disabled = true;
$("btnUndo").onclick = () => uiManager?.undo();
$("btnRedo").onclick = () => uiManager?.redo();

/**
 * A photo about to be inserted can go through the scanner first (straighten, whiten the paper).
 * Asks each time unless the user chose "remember"; resolves to the file to insert, or null.
 */
async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type)) return file;
  let choice = store.get("imageScan", "ask");
  if (choice === "ask") {
    const body = document.createElement("div");
    body.className = "closeall";
    body.append(text(t("imgScanBody")));
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox"><span></span>`;
    label.querySelector("span").textContent = t("rememberChoice");
    body.append(label);
    choice = await dialog({ title: t("imgScanTitle"), body, buttons: [{ label: t("imgAsIs"), value: "asis", kind: "secondary" }, { label: t("imgScan"), value: "scan", kind: "primary" }] });
    if (choice !== "asis" && choice !== "scan") return null;
    if (label.querySelector("input").checked) store.set("imageScan", choice);
  }
  return choice === "scan" ? pro.scanImage(file) : file;
}

/** Adds an image (or signature) to the current page as a movable, resizable object. */
async function addImage(file, { photo = true } = {}) {
  if (!doc.pdf || !file) return;
  if (photo) { file = await prepareImage(file); if (!file) return; }
  await setTool("stamp");
  await sleep(80);
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

const studio = createSignatureStudio({ dialog, icon, toast, store });

async function signDialog() {
  if (!doc.pdf) return;
  const url = await studio.open();
  if (url) placeSignature(url);
}
$("btnSign").onclick = signDialog;

/** Lets the user click where the signature goes; a preview follows the pointer. */
function placeSignature(url) {
  const ghost = new Image();
  ghost.src = url;
  ghost.className = "sig-ghost";
  const widthPt = store.get("sigWidth", 170);
  const widthPx = () => widthPt * viewer.currentScale * (96 / 72);
  document.body.append(ghost);
  document.body.classList.add("placing");
  toast(t("sigPlaceHint"), 6000);
  const move = (e) => {
    ghost.style.width = widthPx() + "px";
    ghost.style.left = e.clientX - ghost.offsetWidth / 2 + "px";
    ghost.style.top = e.clientY - ghost.offsetHeight / 2 + "px";
    ghost.hidden = !e.target.closest?.(".page");
  };
  const done = () => {
    ghost.remove(); document.body.classList.remove("placing");
    container.removeEventListener("pointermove", move);
    container.removeEventListener("click", click, true);
    removeEventListener("keydown", key, true);
  };
  const click = async (e) => {
    const pageDiv = e.target.closest?.(".page");
    if (!pageDiv) return;
    e.preventDefault(); e.stopPropagation();
    const r = pageDiv.getBoundingClientRect();
    const pageIndex = +pageDiv.dataset.pageNumber - 1;
    done();
    await addImageAt(urlToFile(url), pageIndex, e.clientX - r.left, e.clientY - r.top, widthPx());
    toast(t("sigPlaced"), 4000);
  };
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
  container.addEventListener("pointermove", move);
  container.addEventListener("click", click, true);
  addEventListener("keydown", key, true);
}

/** Adds an image as a movable object centred on (px, py) of a page, `widthPx` wide. */
async function addImageAt(file, pageIndex, px, py, widthPx) {
  await setTool("stamp");
  await sleep(80);
  const layer = uiManager?.getLayer(pageIndex);
  if (!layer) return addImage(file, { photo: false });
  const before = new Set(uiManager.getEditors(pageIndex));
  await layer.pasteEditor({ mode: ED.STAMP }, { bitmapFile: file });
  let ed = null;
  for (let k = 0; k < 60; k++) {
    ed = [...uiManager.getEditors(pageIndex)].find((x) => !before.has(x));
    if (ed?.div?.querySelector("canvas") && ed.width > 0) break;
    await sleep(50);
  }
  if (!ed) return;
  const [pw, ph] = ed.parentDimensions;
  const aspect = (ed.height * ph) / (ed.width * pw);
  const w = Math.min(0.9, widthPx / pw), h = (w * pw * aspect) / ph;
  ed.width = w; ed.height = h;
  ed.setDims();
  ed.x = Math.max(0, Math.min(1 - w, px / pw - w / 2));
  ed.y = Math.max(0, Math.min(1 - h, py / ph - h / 2));
  ed.fixAndSetPosition();
  ed._onResized?.();
}

/* ================================================================== find */

const findInput = $("findInput");
const search = createSearch({ viewer, container, t, onUpdate: () => showFind() });
eventBus.on("textlayerrendered", ({ pageNumber }) => search.onTextLayer(pageNumber));
const findOpts = () => ({ matchCase: $("findCase").checked, wholeWords: $("findWords").checked, matchAccents: $("findDiacritics").checked, highlightAll: $("findAll").checked });

function openFind() {
  if (!doc.pdf) return;
  $("findPanel").hidden = false;
  search.warm();
  const sel = getSelection()?.toString().trim().replace(/\s+/g, " ");
  if (sel && sel.length < 120 && !findInput.contains(document.activeElement)) findInput.value = sel;
  findInput.focus(); findInput.select();
  if (findInput.value) search.search(findInput.value, findOpts());
  showFind();
}
function closeFind() {
  $("findPanel").hidden = true;
  search.clear();
  container.focus();
}
function showFind() {
  const st = search.state();
  const has = !!findInput.value.trim();
  const reading = st.ready < st.of;
  $("findCount").textContent = !has ? "" : st.total ? t("findOf", { n: st.current + 1 || "–", total: st.total + (st.capped ? "+" : "") }) : reading ? "…" : t("findNone");
  $("findPrev").disabled = $("findNext").disabled = !st.total;
  $("findInput").classList.toggle("none", has && !st.total && !reading);
  const status = $("findStatus");
  status.textContent = !has ? (reading && st.ready ? t("findReading", { p: Math.round((st.ready * 100) / st.of) }) : "") :
    st.total ? t("findPages", { n: st.pages }) + (reading ? " · " + t("findReading", { p: Math.round((st.ready * 100) / st.of) }) : "") : reading ? t("findReading", { p: Math.round((st.ready * 100) / st.of) }) : "";
  const list = $("findList");
  list.hidden = !has || !st.total;
  if (list.hidden) { list.replaceChildren(); return; }
  // results with their context, grouped by page
  const frag = document.createDocumentFragment();
  let page = 0;
  for (const r of st.list) {
    if (r.page !== page) { page = r.page; const h = document.createElement("div"); h.className = "fhead"; h.textContent = t("pageN", { n: page }); frag.append(h); }
    const b = document.createElement("button");
    b.className = "fres" + (r.k === st.current ? " on" : "");
    b.append(document.createTextNode(r.before));
    const m = document.createElement("mark"); m.textContent = r.match; b.append(m);
    b.append(document.createTextNode(r.after));
    b.onclick = () => search.go(r.k);
    frag.append(b);
  }
  if (st.more) { const more = document.createElement("div"); more.className = "fmore"; more.textContent = t("findMore", { n: st.more }); frag.append(more); }
  list.replaceChildren(frag);
  list.querySelector(".fres.on")?.scrollIntoView({ block: "nearest" });
}
let findTimer;
findInput.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => search.search(findInput.value, findOpts()), 60); });
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    // the first Enter after typing shows the first match; the next ones go through them
    if (search.state(0).query !== findInput.value) { clearTimeout(findTimer); search.search(findInput.value, findOpts()); }
    else search.step(e.shiftKey ? -1 : 1);
  }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); search.step(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); search.step(-1); }
});
$("findNext").onclick = () => search.step(1);
$("findPrev").onclick = () => search.step(-1);
$("findClose").onclick = closeFind;
$("btnFind").onclick = () => ($("findPanel").hidden ? openFind() : closeFind());
for (const id of ["findAll", "findCase", "findWords", "findDiacritics"]) $(id).onchange = () => search.setOptions(findOpts());

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
    const vp = first.getViewport({ scale: 1, rotation: (first.rotate + viewer.pagesRotation) % 360 });
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
        const rotation = (page.rotate + viewer.pagesRotation) % 360;
        const scale = WIDTH / page.getViewport({ scale: 1, rotation }).width, dpr = Math.min(2, devicePixelRatio || 1);
        const vp = page.getViewport({ scale: scale * dpr, rotation });
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
  for (const id of ["thumbs", "outline", "comments"]) $(id).hidden = name !== id;
  $("panelTitle").textContent = t({ thumbs: "thumbnails", outline: "bookmarks", comments: "commentsPanel" }[name]);
  store.set("panel", name);
  if (name === "comments") setTimeout(() => pro.refreshComments(), 0);
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
  if (editor.active) await editor.exit(true);
  const pdf = doc.pdf, total = pdf.numPages;
  const overlay = document.createElement("div");
  overlay.className = "progress";
  overlay.innerHTML = `<div><b>${t("printing")}</b><div class="small muted" data-s></div><progress max="${total}" value="0"></progress></div>`;
  document.body.append(overlay);
  const out = $("printContainer");
  out.replaceChildren();
  const urls = [];
  const cleanup = () => { out.replaceChildren(); urls.forEach(URL.revokeObjectURL); };
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
    overlay.remove(); cleanup(); return;
  }
  overlay.remove();
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
  const lang = /[Ͱ-Ͽἀ-῿]/.test(text) || LANG === "el" ? "el-GR" : "en-US";
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
  const rows = [
    ["kOpen", mod + "O"], ["kSave", mod + "S"], ["kSaveAs", mod + shift + "S"], ["kPrint", mod + "P"], ["kFind", mod + "F"],
    ["kSidebar", "F4"], ["kZoom", `${mod}+ / ${mod}−`], ["kActual", mod + "1"], ["kFitPage", mod + "0"], ["kFitWidth", mod + "2"],
    ["kRotate", `${mod}${shift}+ / ${mod}${shift}−`], ["kNav", "→ / ←"], ["kFirstLast", "Home / End"], ["kPresent", mod + "L"],
    ["kEdit", mod + "E"], ["kClose", mod + "W"], ["kTabs", "Ctrl+Tab / Ctrl+Shift+Tab"], ["kSelect", "V"], ["kHand", "H"], ["kUndo", `${mod}Z / ${mod}Y`], ["kNight", "N"], ["kProps", mod + "D"], ["kRead", mod + shift + "Y"], ["kHelp", "?"],
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
  p.textContent = t("aboutBody", { v: VERSION }) + "\n\n© 2026 Vasileios Tripolidis. All rights reserved.";
  dialog({ title: t("about"), body: p, buttons: [{ label: t("ok"), value: "ok", kind: "primary" }] });
}

/* ================================================================== night mode */

function setNight(on) {
  document.body.classList.toggle("night", on);
  store.set("night", on);
}
setNight(store.get("night", false));

/* ================================================================== theme */

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || "system";
const isDark = () => (currentTheme() === "system" ? darkQuery.matches : currentTheme() === "dark");

function setTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  store.set("theme", theme);
  updateThemeButton();
}
function updateThemeButton() {
  const b = $("btnTheme"), dark = isDark();
  b.innerHTML = icon(dark ? "sun" : "moon");
  b.dataset.tip = dark ? "themeToLight" : "themeToDark";
  b.setAttribute("aria-label", t(b.dataset.tip));
}
darkQuery.addEventListener("change", updateThemeButton);
$("btnTheme").onclick = () => setTheme(isDark() ? "light" : "dark");
setTheme(store.get("theme", "system"));

/* ================================================================== language */

async function setLanguage(lang) {
  if (lang === store.get("lang", "system")) return;
  if (tabs.some(tabDirty)) return toast(t("langSaveFirst"), 5000);
  const paths = tabs.map((x) => (x === active ? doc.path : x.path));
  if (paths.some((p) => !p)) {
    const p = document.createElement("p"); p.textContent = t("langReload");
    const r = await dialog({ title: t("language"), body: p, buttons: [{ label: t("cancel"), value: "cancel" }, { label: t("ok"), value: "ok", kind: "primary" }] });
    if (r !== "ok") return;
  }
  store.set("lang", lang);
  if (paths.length) store.set("reopen", { paths: paths.filter(Boolean), active: active === null ? -1 : paths.filter(Boolean).indexOf(doc.path) }); // reopened after the reload
  location.reload();
}
{
  const reopen = store.get("reopen", null);
  // Start screen: shown only when Flipleaf was not started to open a file (avoids a flash of it).
  startFiles.then((n) => {
    if (!n && !reopen && !(remote && !platform.isDesktop) && !doc.pdf) { $("home").hidden = false; $("launching")?.remove(); }
    else setTimeout(() => { if (!doc.pdf && !tabs.length) showHome(); }, 30000); // safety net
  });
  if (reopen) {
    store.set("reopen", null);
    const { paths = [reopen], active: at = 0 } = typeof reopen === "string" ? {} : reopen;
    licenseGate.then(async () => {
      for (const p of paths) await openPath(p);
      if (tabs[at]) selectTab(tabs[at]);
    }).catch(() => {});
  }
}

/* ================================================================== updates */

// Desktop only. Never forced: the user can always choose "Later" or skip a version.
// Automatic check: once per calendar month, on the first launch on or after the 1st
// (a failed check, e.g. offline, is retried on the next launch). Manual check: any time.
const monthOf = (time) => { const d = new Date(time); return d.getFullYear() * 12 + d.getMonth(); };
const updateCheckDue = () => monthOf(store.get("lastUpdateCheck", 0)) !== monthOf(Date.now());
/** Resolves when no other dialog (password, license, a tool) is open, so the update prompt never replaces one. */
const whenNoDialog = () => new Promise((done) => { const tick = () => ($("dlg").open ? setTimeout(tick, 1500) : done()); tick(); });

async function checkForUpdates(manual) {
  if (!platform.isDesktop) { if (manual) toast(t("upWeb")); return; }
  let info;
  try { info = await platform.checkUpdate(); }
  catch { if (manual) toast(t("upError"), 5000); return; }
  store.set("lastUpdateCheck", Date.now());
  if (!info) { if (manual) toast(t("upLatest", { v: VERSION })); return; }
  if (!manual && store.get("skipVersion", null) === info.version) return;
  if (!manual) await whenNoDialog();

  const body = document.createElement("div");
  const p = document.createElement("p");
  p.textContent = t("upBody", { v: info.version, cur: VERSION });
  body.append(p);
  // Only the "What's new" section of the release text is shown (the rest is the download table).
  const news = info.notes?.match(/#+\s*What's new\s*\n([\s\S]*?)(?=\n#+\s|$)/i)?.[1].replace(/[*`]/g, "").trim();
  if (news) {
    const h = document.createElement("p"), pre = document.createElement("div");
    h.className = "small muted"; h.textContent = t("upNotes");
    pre.className = "upnotes"; pre.textContent = news.slice(0, 1500);
    body.append(h, pre);
  }
  const choice = await dialog({ title: t("upTitle"), body, buttons: [
    { label: t("upSkip"), value: "skip" },
    { label: t("upLater"), value: "cancel" },
    { label: info.canInstall ? t("upInstall") : t("upDownload"), value: "go", kind: "primary" },
  ] });
  if (choice === "skip") return store.set("skipVersion", info.version);
  if (choice !== "go") return;
  if (!info.canInstall) return platform.openExternal("https://github.com/vasileiostripolidis/flipleaf/releases/latest");
  if (tabs.some(tabDirty)) return toast(t("upSaveFirst"), 5000);
  try {
    store.set("updating", info.version); // shown as "update complete" after the restart
    await platform.installUpdate((got, total) => {
      toast(total ? t("upDownloading", { p: Math.round((got / total) * 100) + "%" }) : t("upDownloading", { p: "" }), 60000);
      if (total && got >= total) toast(t("upRestart"), 60000);
    });
  } catch (e) { store.set("updating", null); toast(t("upFailed", { e: String(e) }), 8000); }
}
{
  const to = store.get("updating", null);
  if (to) { store.set("updating", null); if (to === VERSION) setTimeout(() => toast(t("upDone", { v: VERSION }), 6000), 800); }
}

// "direct" | "store" | "web"; the Store and the web version update themselves.
let updateChannel = platform.isDesktop ? "direct" : "web";
platform.updateChannel.then((c) => {
  updateChannel = c;
  if (c === "direct" && store.get("autoUpdate", true) && updateCheckDue()) setTimeout(() => checkForUpdates(false), 5000);
});

/* ================================================================== menu bar */

const hasDoc = () => !!doc.pdf;
const MENUS = {
  file: () => [
    { label: "openFile2", key: mod + "O", icon: "folder-open", run: openPicker },
    { label: "openRecent", icon: "clock", sub: recentMenu, when: () => platform.isDesktop },
    { label: "createPdf", icon: "plus", sub: () => [
      { label: "combine", icon: "copy", pro: true, run: () => pro.combine() },
      { label: "scan", icon: "scan-line", pro: true, run: () => pro.scan() },
      { label: "imagesToPdf", icon: "image-plus", pro: true, run: () => pro.imagesToPdf() },
    ] },
    "-",
    { label: "save", key: mod + "S", icon: "save", run: () => save(), when: hasDoc },
    { label: "saveAs", key: mod + shift + "S", icon: "download", run: () => save({ as: true }), when: hasDoc },
    { label: "exportTo", icon: "file-text", when: hasDoc, sub: () => pro.menuItems("catConvert").filter((x) => /^export/.test(x.label)) },
    { label: "compress", icon: "minus", pro: true, when: hasDoc, run: () => pro.compress() },
    { label: "protect", icon: "scale", pro: true, when: hasDoc, run: () => pro.protect() },
    "-",
    { label: "print", key: mod + "P", icon: "printer", run: printDocument, when: hasDoc },
    "-",
    { label: "properties", key: mod + "D", icon: "info", run: showProperties, when: hasDoc },
    "-",
    { label: "closeDoc", key: mod + "W", icon: "x", run: closeFile, when: hasDoc },
    { label: "closeOthers", icon: "x", run: () => closeOthers(), when: () => tabs.length > 1 },
    { label: "settings", icon: "settings", key: mod + ",", run: openSettings },
    { label: "exit", key: platform.os === "mac" ? "⌘Q" : "Alt+F4", icon: "log-out", run: () => platform.quit(), when: () => platform.isDesktop },
  ],
  edit: () => [
    { label: "undo", key: mod + "Z", icon: "undo-2", run: () => uiManager?.undo(), when: () => hasDoc() && !$("btnUndo").disabled },
    { label: "redo", key: mod + "Y", icon: "redo-2", run: () => uiManager?.redo(), when: () => hasDoc() && !$("btnRedo").disabled },
    "-",
    { label: "copy", key: mod + "C", icon: "copy", run: () => document.execCommand("copy"), when: () => !!getSelection()?.toString() },
    { label: "find", key: mod + "F", icon: "search", run: openFind, when: hasDoc },
    "-",
    { label: "editPdf", key: mod + "E", icon: "file-pen-line", run: () => toggleEditPdf(true), when: hasDoc },
    { label: "editAddText", icon: "text-cursor-input", run: () => toggleEditPdf(true).then(() => editor.addTextMode()), when: hasDoc },
    { label: "editAddImage", icon: "image-plus", run: () => toggleEditPdf(true).then(() => editor.addImageDialog()), when: hasDoc },
  ],
  view: () => [
    { label: "zoomIn", key: mod + "+", icon: "zoom-in", run: () => viewer.increaseScale(), when: hasDoc },
    { label: "zoomOut", key: mod + "−", icon: "zoom-out", run: () => viewer.decreaseScale(), when: hasDoc },
    { label: "zActual", key: mod + "1", run: () => (viewer.currentScaleValue = "page-actual"), when: hasDoc },
    { label: "zFit", key: mod + "0", run: () => (viewer.currentScaleValue = "page-fit"), when: hasDoc },
    { label: "zWidth", key: mod + "2", run: () => (viewer.currentScaleValue = "page-width"), when: hasDoc },
    "-",
    { label: "rotateCw", key: mod + shift + "+", icon: "rotate-cw", run: () => rotate(90), when: hasDoc },
    { label: "rotateCcw", key: mod + shift + "−", icon: "rotate-ccw", run: () => rotate(-90), when: hasDoc },
    "-",
    { label: "pageDisplay", icon: "book-open", when: hasDoc, sub: () => [
      { label: "singlePage", icon: "file", check: currentLayout === "single", run: () => applyLayout("single") },
      { label: "continuous", icon: "gallery-vertical-end", check: currentLayout === "scroll", run: () => applyLayout("scroll") },
      { label: "twoPage", icon: "book-open", check: currentLayout === "two", run: () => applyLayout("two") },
      { label: "twoPageScroll", icon: "columns-2", check: currentLayout === "twoScroll", run: () => applyLayout("twoScroll") },
    ] },
    { label: "showSidebar", key: "F4", icon: "panel-left", check: !$("sidebar").hidden, run: () => toggleSidebar(), when: hasDoc },
    "-",
    { label: "presentation", key: mod + "L", icon: "presentation", run: () => present(true), when: hasDoc },
    { label: "language", icon: "languages", sub: () => [["system", t("langSystem")], ["en", "English"], ["el", "Ελληνικά"]].map(([v, text]) => ({ text, check: store.get("lang", "system") === v, run: () => setLanguage(v) })) },
    { label: "theme", icon: "moon", sub: () => ["system", "light", "dark"].map((v) => ({ label: "theme" + v[0].toUpperCase() + v.slice(1), check: currentTheme() === v, run: () => setTheme(v) })) },
    { label: "nightMode", key: "N", icon: "moon", check: document.body.classList.contains("night"), run: () => setNight(!document.body.classList.contains("night")) },
    { label: "readAloud", key: mod + shift + "Y", icon: "volume-2", run: () => readAloud(), when: () => hasDoc() && !!speech },
  ],
  tools: () => [
    { label: "allTools", icon: "layout-grid", run: () => pro.allTools() },
    { label: "editPdf", key: mod + "E", icon: "file-pen-line", run: () => toggleEditPdf(true), when: hasDoc },
    "-",
    { label: "catEdit", icon: "layout-grid", sub: () => pro.menuItems("catEdit") },
    { label: "catConvert", icon: "file-text", sub: () => pro.menuItems("catConvert") },
    { label: "catForms", icon: "text-cursor-input", sub: () => pro.menuItems("catForms") },
    { label: "catSecurity", icon: "scale", sub: () => pro.menuItems("catSecurity") },
    { label: "catComments", icon: "file-pen-line", sub: () => pro.menuItems("catComments") },
    "-",
    { label: "toolHighlight", icon: "highlighter", run: () => setTool("highlight"), when: hasDoc },
    { label: "toolDraw", icon: "pen-line", run: () => setTool("ink"), when: hasDoc },
    { label: "toolText", icon: "type", run: () => setTool("freetext"), when: hasDoc },
    { label: "toolImage", icon: "image-plus", run: () => $("imageInput").click(), when: hasDoc },
    { label: "toolSign", icon: "signature", run: signDialog, when: hasDoc },
    "-",
    { label: "toolSelect", key: "V", icon: "mouse-pointer-2", run: () => setTool("select"), when: hasDoc },
    { label: "toolHand", key: "H", icon: "hand", run: () => setTool("hand"), when: hasDoc },
  ],
  help: () => [
    { label: "shortcuts", key: "?", icon: "keyboard", run: showShortcuts },
    { label: "licenses", icon: "scale", run: () => showLicense(false) },
    "-",
    { label: "checkUpdates", icon: "download", run: () => checkForUpdates(true), when: () => updateChannel === "direct" },
    { label: "autoUpdates", check: store.get("autoUpdate", true), run: () => store.set("autoUpdate", !store.get("autoUpdate", true)), when: () => updateChannel === "direct" },
    "-",
    { label: "about", icon: "circle-help", run: showAbout },
  ],
};

async function recentMenu() {
  const list = await platform.recentFiles();
  if (!list.length) return [{ label: "noRecent", disabled: true }];
  return list.slice(0, 10).map(({ path, name }) => ({ text: name, title: path, icon: "file-text", run: () => openPath(path) }));
}

const popup = $("menuPopup"), subPopup = $("subPopup");
let openMenuName = null;

async function fillMenu(el, items) {
  el.replaceChildren();
  for (const it of items) {
    if (it === "-") { if (el.lastElementChild && el.lastElementChild.tagName !== "HR") el.append(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.setAttribute("role", it.check !== undefined ? "menuitemcheckbox" : "menuitem");
    if (it.check !== undefined) b.setAttribute("aria-checked", !!it.check);
    const enabled = !it.disabled && (it.when ? it.when() : true);
    b.disabled = !enabled;
    b.innerHTML = `${it.check ? icon("check", 16) : it.icon ? icon(it.icon, 16) : '<span class="ic-blank"></span>'}<span></span>${it.pro ? `<em class="probadge">${t("pro")}</em>` : ""}${it.sub ? icon("chevron-right", 14) : `<kbd>${it.key || ""}</kbd>`}`;
    b.querySelector("span:not(.ic-blank)").textContent = it.text || t(it.label);
    if (it.title) b.title = it.title;
    if (it.sub) {
      b.classList.add("has-sub");
      const show = async () => {
        if (b.disabled) return;
        await fillMenu(subPopup, await it.sub());
        const r = b.getBoundingClientRect();
        subPopup.hidden = false;
        subPopup.style.top = r.top - 6 + "px";
        subPopup.style.left = (r.right + subPopup.offsetWidth + 4 > innerWidth ? r.left - subPopup.offsetWidth - 4 : r.right + 4) + "px";
      };
      b.addEventListener("pointerenter", show);
      b.addEventListener("click", (e) => { e.stopPropagation(); show(); });
    } else {
      b.addEventListener("pointerenter", () => { if (el === popup) subPopup.hidden = true; });
      b.addEventListener("click", () => { closeMenus(); it.run?.(); });
    }
    el.append(b);
  }
  if (el.lastElementChild?.tagName === "HR") el.lastElementChild.remove();
}

async function openMenu(name) {
  const btn = document.querySelector(`[data-menu="${name}"]`);
  openMenuName = name;
  for (const b of document.querySelectorAll("[data-menu]")) b.classList.toggle("open", b === btn);
  subPopup.hidden = true;
  await fillMenu(popup, MENUS[name]());
  const r = btn.getBoundingClientRect();
  popup.hidden = false;
  popup.style.top = r.bottom + 4 + "px";
  popup.style.left = Math.min(r.left, innerWidth - popup.offsetWidth - 8) + "px";
}
function closeMenus() {
  openMenuName = null;
  popup.hidden = subPopup.hidden = true;
  for (const b of document.querySelectorAll("[data-menu]")) b.classList.remove("open");
}
for (const b of document.querySelectorAll("[data-menu]")) {
  b.addEventListener("click", (e) => { e.stopPropagation(); openMenuName === b.dataset.menu ? closeMenus() : openMenu(b.dataset.menu); });
  b.addEventListener("pointerenter", () => { if (openMenuName && openMenuName !== b.dataset.menu) openMenu(b.dataset.menu); });
}
addEventListener("pointerdown", (e) => {
  if (openMenuName && !popup.contains(e.target) && !subPopup.contains(e.target) && !e.target.closest("[data-menu]")) closeMenus();
});
addEventListener("blur", closeMenus);
addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenuName) { e.preventDefault(); e.stopPropagation(); closeMenus(); } }, true);
for (const el of [popup, subPopup]) el.addEventListener("keydown", (e) => {
  const items = [...el.querySelectorAll("button:not(:disabled)")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === "Escape") { e.preventDefault(); closeMenus(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const names = Object.keys(MENUS), k = names.indexOf(openMenuName);
    e.preventDefault(); openMenu(names[(k + (e.key === "ArrowRight" ? 1 : names.length - 1)) % names.length]).then(() => popup.querySelector("button:not(:disabled)")?.focus());
  }
});
// Alt opens the File menu, like desktop apps
let altAlone = false;
addEventListener("keydown", (e) => { altAlone = e.key === "Alt"; }, true);
addEventListener("keyup", (e) => {
  if (e.key === "Alt" && altAlone && !$("dlg").open) { e.preventDefault(); openMenu("file").then(() => popup.querySelector("button:not(:disabled)")?.focus()); }
  altAlone = false;
});

const closeFile = () => closeTab(active);
const closeOthers = serial(async () => {
  const keep = active;
  for (const tab of tabs.filter((x) => x !== keep)) if (!(await closeTabNow(tab))) return;
  if (keep && active !== keep) await selectTabNow(keep);
});

/* ================================================================== edit text & images (PDFium) */

const editor = createEditor({
  viewer, eventBus, t, toast, icon,
  pickSignature: async () => { const url = await studio.open(); return url ? urlToFile(url) : null; },
  prepareImage: (f) => prepareImage(f),
  onChange: () => setDirty(true),
  onApply: (bytes) => replaceDocumentData(bytes),
  reload: (bytes) => replaceDocumentData(bytes.slice()),
  onRestore: (bytes) => replaceDocumentData(bytes, { dirty: editWasDirty }),
});
let editWasDirty = false;
async function toggleEditPdf(on = !editor.active) {
  if (!doc.pdf) return;
  if (!on) return editor.exit(true);
  if (editor.active) return;
  await setTool("select");
  closeFind();
  const overlay = busy(t("editLoading"));
  try {
    const bytes = await documentBytes();
    editWasDirty = doc.dirty;
    await editor.enter(bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes), doc.password);
  } catch (e) {
    toast(t("failed", { err: e?.message || e }), 6000);
  } finally { overlay.remove(); }
}
$("btnEditPdf").onclick = () => toggleEditPdf();

/* ================================================================== Pro tools */

const pro = installPro({
  t, toast, icon, dialog, busy, platform, viewer, eventBus, pdfjsLib, LANG, store, doc,
  documentBytes, replaceDocumentData, openData, addImage, signDialog, renameCompressed,
  showCommentsPanel: () => { toggleSidebar(true); showPanel("comments"); },
});
$("btnAllTools").onclick = () => pro.allTools();

/** Loads new bytes for the open document (after editing), keeping page, zoom and rotation. */
async function replaceDocumentData(bytes, { dirty = true } = {}) {
  const keep = { page: viewer.currentPageNumber, scale: viewer.currentScaleValue, rotation: viewer.pagesRotation, name: doc.name, path: doc.path };
  const task = pdfjsLib.getDocument({ data: bytes, ...LOAD_OPTIONS, password: doc.password });
  const size = bytes.byteLength;
  const pdf = await task.promise;
  const old = doc.task;
  doc.task = task;
  Object.assign(doc, { pdf, size, key: pdf.fingerprints[0] });
  pdf.annotationStorage.onSetModified = () => setDirty(true);
  store.set("view." + doc.key, { page: keep.page, scale: keep.scale, rotation: keep.rotation });
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  $("pageCount").textContent = "/ " + pdf.numPages;
  old?.destroy().catch(() => {});
  thumbs.build();
  search.reset(doc.pdf);
  if (!$("findPanel").hidden && findInput.value) search.search(findInput.value, findOpts());
  buildOutline();
  setDirty(dirty);
}

function busy(message) {
  const o = document.createElement("div");
  o.className = "progress";
  o.innerHTML = `<div><b></b><progress></progress></div>`;
  o.querySelector("b").textContent = message;
  document.body.append(o);
  return o;
}

/* ================================================================== license agreement */

const EULA_VERSION = "1.3";
async function showLicense(requireAccept) {
  const load = (f) => fetch(new URL(`./legal/${f}`, import.meta.url)).then((r) => r.text()).catch(() => "");
  const [eula, notices] = await Promise.all([load("EULA.txt"), load("THIRD-PARTY-NOTICES.txt")]);
  const box = document.createElement("div");
  box.innerHTML = `<p class="muted small" style="margin:0 0 10px"></p>
    <div class="tabs"><button type="button" class="on" data-tab="eula"></button><button type="button" data-tab="notices"></button></div>
    <pre class="legal"></pre>`;
  box.querySelector("p").textContent = requireAccept ? t("licenseIntro") : `Flipleaf ${VERSION} · © 2026 Vasileios Tripolidis · All rights reserved`;
  const [tabE, tabN] = box.querySelectorAll("[data-tab]");
  tabE.textContent = t("licenseTitle"); tabN.textContent = "Third-party notices";
  const pre = box.querySelector("pre");
  // show the Greek half first for Greek users
  const parts = eula.split(/\n-{20,}\n/);
  const eulaText = LANG === "el" && parts.length > 1 ? parts[1].trim() + "\n\n" + "-".repeat(60) + "\n\n" + parts[0].trim() : eula;
  pre.textContent = eulaText;
  const show = (which) => { tabE.classList.toggle("on", which === "eula"); tabN.classList.toggle("on", which !== "eula"); pre.textContent = which === "eula" ? eulaText : notices; pre.scrollTop = 0; };
  tabE.onclick = () => show("eula"); tabN.onclick = () => show("notices");
  const buttons = requireAccept
    ? [{ label: t("decline"), value: "decline", kind: "secondary" }, { label: t("accept"), value: "accept", kind: "primary" }]
    : [{ label: t("ok"), value: "ok", kind: "primary" }];
  $("dlg").classList.add("wide");
  const r = await dialog({ title: t("licenseTitle"), body: box, buttons });
  $("dlg").classList.remove("wide");
  return r;
}
async function requireLicense() {
  if (!platform.isDesktop || store.get("eula", null) === EULA_VERSION) return;
  const r = await showLicense(true);
  if (r === "accept") store.set("eula", EULA_VERSION);
  else platform.quit();
}
requireLicense().then(() => licenseAnswered());

/* ================================================================== window controls (custom title bar) */

if (platform.customTitleBar) {
  $("winctl").hidden = false;
  $("wcMin").onclick = () => platform.windowAction("minimize");
  $("wcMax").onclick = () => platform.windowAction("toggleMaximize");
  $("wcClose").onclick = () => platform.windowAction("close");
  platform.onMaximizedChange((max) => { $("wcMax").innerHTML = icon(max ? "copy" : "square", 13); $("wcMax").setAttribute("aria-label", max ? "Restore" : "Maximize"); });
}
if (platform.os === "mac" && platform.isDesktop) document.body.classList.add("mac-titlebar");

/* ================================================================== keyboard */

addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  // letters by key position, so shortcuts also work with the Greek keyboard layout
  const key = mod && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
  const typing = e.target.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
  if ($("dlg").open) return;

  if (mod && key === "o") { e.preventDefault(); openPicker(); return; }
  // PDF.js reads the letter itself, so with the Greek layout Ctrl+Z/Y would do nothing
  if (mod && !typing && !editor.active && doc.pdf && /^[^a-z]$/i.test(e.key) && (key === "z" || key === "y")) {
    e.preventDefault(); e.stopPropagation();
    if (key === "y" || e.shiftKey) uiManager?.redo(); else uiManager?.undo();
    return;
  }
  if (editor.active) { if (mod && key === "s") { e.preventDefault(); editor.exit(true).then(() => save({ as: e.shiftKey })); } return; }
  if (!doc.pdf) return;
  if (mod && key === "s") { e.preventDefault(); save({ as: e.shiftKey }); return; }
  if (mod && key === "p") { e.preventDefault(); printDocument(); return; }
  if (mod && key === "f") { e.preventDefault(); openFind(); return; }
  if (mod && key === "l") { e.preventDefault(); present(); return; }
  if (mod && key === "d") { e.preventDefault(); showProperties(); return; }
  if (mod && key === "e") { e.preventDefault(); toggleEditPdf(true); return; }
  if (mod && key === "w") { e.preventDefault(); closeFile(); return; }
  if (mod && e.key === ",") { e.preventDefault(); openSettings(); return; }
  if (e.ctrlKey && (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp")) { e.preventDefault(); cycleTab(e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1); return; }
  if (mod && key === "q" && platform.isDesktop) { e.preventDefault(); platform.quit(); return; }
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
    if (currentTool !== "select" && currentTool !== "hand" && !uiManager?.hasSelection) setTool("select");
    return;
  }
  if (typing || mod || e.altKey) return;
  if (viewer.annotationEditorMode > 0 && uiManager?.hasSelection) return; // an annotation is being edited
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
  const files = [...(e.dataTransfer?.files || [])];
  const f = files[0];
  if (!f) return;
  const images = files.filter((x) => /^image\//.test(x.type));
  if (images.length && doc.pdf) addImage(images[0]);
  else if (images.length) pro.scan(images); // photos dropped on the start screen go to the scanner
  else files.forEach(openFile);
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
    tip.replaceChildren(t(el.dataset.tip));
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
window.flipleaf = { viewer, eventBus, doc, pro, tabs, closeGuard, get uiManager() { return uiManager; } };
