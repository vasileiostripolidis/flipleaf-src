//! Flipleaf desktop shell.
//!
//! The viewer itself is the web app in `../src`. Rust handles what a web page can't:
//! native Open/Save dialogs, reading and writing files, recent files, printing and
//! opening links in the system browser, and checking for / installing updates.
//!
//! Security model: the interface can only read or overwrite PDF files that *the user*
//! chose — opened from the OS ("Open with", double-click), picked in an Open/Save
//! dialog, or listed in Recent files. It has no general access to the disk.

use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State, WebviewWindow,
};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_RECENT: usize = 12;

#[derive(Default)]
struct Files {
    /// Files waiting to be opened by the viewer.
    pending: Mutex<Vec<PathBuf>>,
    /// Files the user chose; only these may be read or written.
    allowed: Mutex<HashSet<PathBuf>>,
    /// Most recent first.
    recent: Mutex<Vec<PathBuf>>,
    /// Output folders the user picked (split, export images…).
    folders: Mutex<HashSet<PathBuf>>,
}

fn is_pdf(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

fn normalize(p: &Path) -> PathBuf {
    plain(&p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
}

/// Windows: canonical paths come back as `\\?\C:\…`; keep the ordinary form `C:\…` (and `\\server\…`).
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

impl Files {
    fn allow(&self, p: &Path) -> PathBuf {
        let p = normalize(p);
        self.allowed.lock().unwrap().insert(p.clone());
        p
    }
    fn is_allowed(&self, p: &Path) -> bool {
        let p = normalize(p);
        self.allowed.lock().unwrap().contains(&p) || self.recent.lock().unwrap().contains(&p)
    }
    fn queue(&self, p: PathBuf) {
        if is_pdf(&p) && p.is_file() {
            let p = self.allow(&p);
            self.pending.lock().unwrap().push(p);
        }
    }
}

/* ------------------------------------------------------------------ recent files */

fn recent_store(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("recent.json"))
}

fn load_recent(app: &AppHandle) -> Vec<PathBuf> {
    recent_store(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .fold(Vec::new(), |mut list, p| {
            let p = plain(&p);
            if !list.contains(&p) {
                list.push(p);
            }
            list
        })
}

fn save_recent(app: &AppHandle, list: &[PathBuf]) {
    if let Some(f) = recent_store(app) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(list) {
            let _ = std::fs::write(f, json);
        }
    }
}

fn touch_recent(app: &AppHandle, files: &Files, p: &Path) {
    let p = normalize(p);
    let mut list = files.recent.lock().unwrap();
    list.retain(|x| x != &p);
    list.insert(0, p);
    list.truncate(MAX_RECENT);
    save_recent(app, &list);
}

#[derive(Serialize)]
struct RecentFile {
    path: String,
    name: String,
}

#[tauri::command]
fn recent_files(files: State<Files>) -> Vec<RecentFile> {
    files
        .recent
        .lock()
        .unwrap()
        .iter()
        .filter(|p| p.is_file())
        .map(|p| RecentFile {
            path: p.to_string_lossy().into_owned(),
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        })
        .collect()
}

#[tauri::command]
fn forget_recent(app: AppHandle, path: String, files: State<Files>) {
    let p = normalize(Path::new(&path));
    let mut list = files.recent.lock().unwrap();
    list.retain(|x| x != &p);
    save_recent(&app, &list);
}

/* ------------------------------------------------------------------ opening */

/// Returns (and clears) the list of files waiting to be opened.
#[tauri::command]
fn pending_files(files: State<Files>) -> Vec<String> {
    std::mem::take(&mut *files.pending.lock().unwrap())
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Native "Open" dialog. Returns the chosen path, or None if cancelled.
#[tauri::command]
async fn open_dialog(app: AppHandle, files: State<'_, Files>) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf", "PDF"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    let p = files.allow(&path);
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Reads a file the user chose, as raw bytes.
#[tauri::command]
fn read_pdf(app: AppHandle, path: String, files: State<Files>) -> Result<Response, String> {
    let p = Path::new(&path);
    if !files.is_allowed(p) {
        return Err("This file was not opened through Flipleaf.".into());
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    touch_recent(&app, &files, p);
    Ok(Response::new(bytes))
}

/* ------------------------------------------------------------------ saving */

fn body_bytes(request: &Request) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("Expected raw PDF bytes".into()),
    }
}

fn header(request: &Request, name: &str) -> Option<String> {
    let v = request.headers().get(name)?.to_str().ok()?;
    urlencoding::decode(v).ok().map(|s| s.into_owned())
}

/// Writes atomically: to a temporary file next to the target, then renames it.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("Refusing to write: data is not a PDF".into());
    }
    let tmp = target.with_extension("pdf.flipleaf-tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).or_else(|_| {
        // rename can fail across devices or on some Windows setups; fall back to copy
        std::fs::copy(&tmp, target).map(|_| ()).map_err(|e| e.to_string())?;
        std::fs::remove_file(&tmp).map_err(|e| e.to_string())
    })
}

/// Overwrites a file the user opened.
#[tauri::command]
fn save_pdf(app: AppHandle, request: Request, files: State<Files>) -> Result<(), String> {
    let path = header(&request, "x-path").ok_or("Missing path")?;
    let p = Path::new(&path);
    if !is_pdf(p) || !files.is_allowed(p) {
        return Err("This file was not opened through Flipleaf.".into());
    }
    write_atomic(p, &body_bytes(&request)?)?;
    touch_recent(&app, &files, p);
    Ok(())
}

/// Native "Save as" dialog, then writes the file. Returns the chosen path, or None if cancelled.
#[tauri::command]
async fn save_pdf_as(app: AppHandle, request: Request<'_>, files: State<'_, Files>) -> Result<Option<String>, String> {
    let bytes = body_bytes(&request)?;
    let name = header(&request, "x-name").unwrap_or_else(|| "document.pdf".into());
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&name)
        .blocking_save_file();
    let Some(mut path) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    if !is_pdf(&path) {
        path.set_extension("pdf");
    }
    write_atomic(&path, &bytes)?;
    let p = files.allow(&path);
    touch_recent(&app, &files, &p);
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// "Save as" for non-PDF outputs (Word, text, images, zip). The user picks the location.
#[tauri::command]
async fn save_bytes_as(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let bytes = body_bytes(&request)?;
    let name = header(&request, "x-name").unwrap_or_else(|| "export".into());
    let ext = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut dialog = app.dialog().file().set_file_name(&name);
    if !ext.is_empty() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }
    let Some(mut path) = dialog.blocking_save_file().and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    if !ext.is_empty() && path.extension().is_none() {
        path.set_extension(&ext);
    }
    if ext == "pdf" {
        write_atomic(&path, &bytes)?;
    } else {
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native folder picker for tools that produce several files.
#[tauri::command]
async fn pick_folder(app: AppHandle, files: State<'_, Files>) -> Result<Option<String>, String> {
    let Some(dir) = app.dialog().file().blocking_pick_folder().and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    let dir = normalize(&dir);
    files.folders.lock().unwrap().insert(dir.clone());
    Ok(Some(dir.to_string_lossy().into_owned()))
}

/// Writes one file into a folder the user picked. File names cannot contain paths.
#[tauri::command]
fn write_in_folder(request: Request, files: State<Files>) -> Result<(), String> {
    let dir = normalize(Path::new(&header(&request, "x-dir").ok_or("Missing folder")?));
    if !files.folders.lock().unwrap().contains(&dir) {
        return Err("This folder was not chosen in Flipleaf.".into());
    }
    let name = header(&request, "x-name").ok_or("Missing name")?;
    if name.is_empty() || name.contains(['/', '\\', ':']) || name.starts_with('.') {
        return Err("Invalid file name".into());
    }
    std::fs::write(dir.join(name), body_bytes(&request)?).map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ misc */

#[tauri::command]
fn print_window(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("Only web and mail links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/* ------------------------------------------------------------------ updates */

/// Updates are signed; the public key is in tauri.conf.json. The check runs here in
/// Rust, so the interface itself still has no network access.
mod updates {
    use serde::Serialize;
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, State};
    use tauri_plugin_updater::{Update, UpdaterExt};

    #[derive(Default)]
    pub struct Pending(Mutex<Option<Update>>);

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Info {
        version: String,
        notes: Option<String>,
        /// false for Linux .deb/.rpm installs: those are updated through the download page.
        can_install: bool,
    }

    fn can_install() -> bool {
        !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
    }

    /// "store" for the Microsoft Store build (updates come from the Store), "direct" otherwise.
    #[tauri::command]
    pub fn update_channel() -> &'static str {
        if cfg!(feature = "store") { "store" } else { "direct" }
    }

    #[tauri::command]
    pub async fn check_update(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<Info>, String> {
        if cfg!(feature = "store") {
            return Ok(None);
        }
        let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        Ok(update.map(|u| {
            let info = Info { version: u.version.clone(), notes: u.body.clone(), can_install: can_install() };
            *pending.0.lock().unwrap() = Some(u);
            info
        }))
    }

    #[tauri::command]
    pub async fn install_update(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
        let update = pending.0.lock().unwrap().take().ok_or("No update was found.")?;
        let progress = app.clone();
        let mut received: u64 = 0;
        update
            .download_and_install(
                move |chunk, total| {
                    received += chunk as u64;
                    let _ = progress.emit("update-progress", (received, total));
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let files = Files::default();
    // Windows / Linux: "Open with Flipleaf" passes the file as an argument.
    for arg in std::env::args_os().skip(1) {
        files.queue(PathBuf::from(arg));
    }

    // Opening another PDF while Flipleaf runs (double-click, "Open with") adds a tab to the
    // running window instead of starting a second copy.
    let builder = tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let files = app.state::<Files>();
        for arg in args.iter().skip(1) {
            let p = PathBuf::from(arg);
            files.queue(if p.is_absolute() { p } else { PathBuf::from(&cwd).join(p) });
        }
        let _ = app.emit("open-files", ());
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));
    #[cfg(not(feature = "store"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(files)
        .manage(updates::Pending::default())
        .setup(|app| {
            *app.state::<Files>().recent.lock().unwrap() = load_recent(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pending_files,
            open_dialog,
            read_pdf,
            save_pdf,
            save_pdf_as,
            save_bytes_as,
            pick_folder,
            write_in_folder,
            recent_files,
            forget_recent,
            print_window,
            open_url,
            updates::update_channel,
            updates::check_update,
            updates::install_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building Flipleaf");

    app.run(|_handle, _event| {
        // macOS: files opened from Finder arrive as an event, possibly while running.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let files = _handle.state::<Files>();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    files.queue(path);
                }
            }
            let _ = _handle.emit("open-files", ());
            if let Some(w) = _handle.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }
    });
}
