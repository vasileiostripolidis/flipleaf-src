// Platform layer: the same app runs as a desktop app (Tauri) or in a web browser.
// Everything that touches files, windows or printing goes through here.

const T = window.__TAURI__;
export const isDesktop = !!T;
const ua = navigator.userAgent;
export const os = /Windows/.test(ua) ? "windows" : /Macintosh|Mac OS X/.test(ua) ? "mac" : "linux";
/** Windows uses our own title bar (menus + window buttons); macOS keeps its traffic lights; Linux keeps the system frame. */
export const customTitleBar = isDesktop && os === "windows";

const invoke = (cmd, args, opts) => T.core.invoke(cmd, args, opts);
const baseName = (p) => p.split(/[\\/]/).pop();

/* ---------------------------------------------------------------- opening */

/** Shows an "Open" dialog. Resolves to { name, data, path } or null. */
export async function pickFile() {
  if (isDesktop) {
    const path = await invoke("open_dialog");
    return path ? readPath(path) : null;
  }
  // Web: the app listens for "change" on #fileInput and opens the chosen file itself.
  const input = document.getElementById("fileInput");
  input.value = "";
  input.click();
  return null;
}

export async function fromFile(file) {
  return { name: file.name, data: new Uint8Array(await file.arrayBuffer()), path: null };
}

export async function readPath(path) {
  const buf = await invoke("read_pdf", { path });
  return { name: baseName(path), data: new Uint8Array(buf), path };
}

/** Files the OS asked us to open (double-click, "Open with", Finder). */
export function onOpenRequest(callback) {
  if (!isDesktop) return;
  const drain = async () => {
    const paths = await invoke("pending_files");
    if (paths.length) callback(paths.at(-1));
  };
  T.event.listen("open-files", drain);
  drain();
}

/* ---------------------------------------------------------------- saving */

/** Overwrites the file at `path`. Desktop only. */
export async function saveToPath(bytes, path) {
  await invoke("save_pdf", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  return path;
}

/** "Save as" dialog. Resolves to the chosen path (desktop), "download" (web), or null if cancelled. */
export async function saveAs(bytes, suggestedName) {
  if (isDesktop) {
    return invoke("save_pdf_as", bytes, { headers: { "x-name": encodeURIComponent(suggestedName) } });
  }
  return download(bytes, suggestedName, "application/pdf");
}

/** "Save as" for any file type (Word, images, text, zip…). Resolves to a path / "download", or null if cancelled. */
export async function saveBytesAs(bytes, name) {
  if (isDesktop) return invoke("save_bytes_as", bytes, { headers: { "x-name": encodeURIComponent(name) } });
  const types = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", png: "image/png", jpg: "image/jpeg", zip: "application/zip" };
  return download(bytes, name, types[name.split(".").pop().toLowerCase()] || "application/octet-stream");
}

/** Web: hands the bytes to the browser as a download. */
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "download";
}

/** Desktop: choose a folder for several output files. */
export async function pickFolder() { return isDesktop ? invoke("pick_folder") : null; }
export async function writeInFolder(dir, name, bytes) {
  return invoke("write_in_folder", bytes, { headers: { "x-dir": encodeURIComponent(dir), "x-name": encodeURIComponent(name) } });
}

/* ---------------------------------------------------------------- recent files */

export async function recentFiles() {
  if (!isDesktop) return [];
  try { return await invoke("recent_files"); } catch { return []; }
}
export async function forgetRecent(path) {
  if (isDesktop) await invoke("forget_recent", { path }).catch(() => {});
}

/* ---------------------------------------------------------------- window */

export function setWindowTitle(title) {
  document.title = title;
  if (isDesktop) T.window.getCurrentWindow().setTitle(title).catch(() => {});
}

export async function setFullscreen(on) {
  if (isDesktop) {
    await T.window.getCurrentWindow().setFullscreen(on).catch(() => {});
  } else if (on) {
    await document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
}

/** Calls `ask()` before the window closes; if it resolves to false the window stays open. */
export function guardClose(ask) {
  if (isDesktop) {
    const win = T.window.getCurrentWindow();
    win.onCloseRequested(async (event) => {
      if (!(await ask())) event.preventDefault();
    });
  } else {
    addEventListener("beforeunload", (e) => { if (ask.isDirty?.()) { e.preventDefault(); e.returnValue = ""; } });
  }
}

export function openExternal(url) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isDesktop) invoke("open_url", { url }).catch(() => {});
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function print() {
  if (isDesktop) return invoke("print_window").catch(() => window.print());
  window.print();
}

/* ---------------------------------------------------------------- custom title bar */

export function windowAction(action) {
  if (!isDesktop) return;
  const win = T.window.getCurrentWindow();
  ({ minimize: () => win.minimize(), toggleMaximize: () => win.toggleMaximize(), close: () => win.close() })[action]?.().catch?.(() => {});
}
export function onMaximizedChange(cb) {
  if (!isDesktop) return;
  const win = T.window.getCurrentWindow();
  const check = () => win.isMaximized().then(cb).catch(() => {});
  win.onResized(check);
  check();
}
export function quit() {
  if (isDesktop) T.window.getCurrentWindow().close().catch(() => {});
}

/* ---------------------------------------------------------------- updates (desktop only) */

/** "store" (Microsoft Store: updates come from the Store), "direct" (built-in updater) or "web". */
export const updateChannel = isDesktop ? invoke("update_channel").catch(() => "direct") : Promise.resolve("web");

/** Resolves to { version, notes, canInstall } when a newer signed release exists, else null. */
export function checkUpdate() { return invoke("check_update"); }

/** Downloads and installs the pending update, reporting (received, total) bytes, then restarts. */
export async function installUpdate(onProgress) {
  const off = await T.event.listen("update-progress", (e) => onProgress?.(...e.payload));
  try { await invoke("install_update"); } finally { off(); }
}
