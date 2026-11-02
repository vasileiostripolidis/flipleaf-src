// Shared access to PDFium (WebAssembly) for every tool that changes a PDF's structure or content.

const BASE = new URL("./vendor/", import.meta.url).href;
let P = null, loading = null;

export async function getPdfium() {
  if (P) return P;
  loading ||= (async () => {
    const { init } = await import("./vendor/pdfium/index.browser.js");
    const wasmBinary = await (await fetch(BASE + "pdfium/pdfium.wasm")).arrayBuffer();
    const mod = await init({ wasmBinary });
    mod.PDFiumExt_Init();
    P = mod;
    return mod;
  })();
  return loading;
}

/* ---------------------------------------------------------- memory helpers (valid after getPdfium) */
export const M = () => P.pdfium;
export const malloc = (n) => M().wasmExports.malloc(n);
export const free = (p) => p && M().wasmExports.free(p);
export const heap = () => M().HEAPU8;
export function putBytes(u8) { const p = malloc(u8.length || 1); heap().set(u8, p); return p; }
export function wstr(s) { const n = (s.length + 1) * 2, p = malloc(n); M().stringToUTF16(s, p, n); return p; }
export function floats(...v) { const p = malloc(4 * v.length); v.forEach((x, i) => M().setValue(p + 4 * i, x, "float")); return p; }
export function ints(...v) { const p = malloc(4 * Math.max(1, v.length)); v.forEach((x, i) => M().setValue(p + 4 * i, x, "i32")); return p; }
export function readFloats(n, fn) {
  const p = malloc(4 * n);
  try { return fn(p) ? Array.from({ length: n }, (_, k) => M().getValue(p + 4 * k, "float")) : null; } finally { free(p); }
}
/** Runs fn with temporary allocations that are freed afterwards. */
export function scoped(fn) {
  const list = [];
  const track = (p) => (list.push(p), p);
  try { return fn({ wstr: (s) => track(wstr(s)), floats: (...v) => track(floats(...v)), ints: (...v) => track(ints(...v)), bytes: (u) => track(putBytes(u)) }); }
  finally { list.forEach(free); }
}

/** A PDF document opened in PDFium. Always call close(). */
export class PdfDoc {
  constructor(handle, dataPtr) { this.h = handle; this.dataPtr = dataPtr; this.pages = new Map(); this.form = 0; this.formInfo = 0; }

  static async open(bytes, password = "") {
    await getPdfium();
    const ptr = putBytes(bytes);
    const h = P.FPDF_LoadMemDocument(ptr, bytes.length, password || "");
    if (!h) { free(ptr); throw new Error(P.FPDF_GetLastError() === 4 ? "password" : "PDFium could not open this PDF"); }
    return new PdfDoc(h, ptr);
  }
  static async create() {
    await getPdfium();
    return new PdfDoc(P.FPDF_CreateNewDocument(), 0);
  }

  get count() { return P.FPDF_GetPageCount(this.h); }

  /** Form environment (needed to create form fields and draw them). */
  enableForms() {
    if (!this.form) { this.formInfo = P.PDFiumExt_OpenFormFillInfo(); this.form = P.PDFiumExt_InitFormFillEnvironment(this.h, this.formInfo); }
    return this.form;
  }

  page(i) {
    let pg = this.pages.get(i);
    if (!pg) { pg = P.FPDF_LoadPage(this.h, i); if (this.form) P.FORM_OnAfterLoadPage(pg, this.form); this.pages.set(i, pg); }
    return pg;
  }
  /** Page indexes change after moving/deleting pages; drop cached handles. */
  releasePages() {
    for (const pg of this.pages.values()) { if (this.form) P.FORM_OnBeforeClosePage(pg, this.form); P.FPDF_ClosePage(pg); }
    this.pages.clear();
  }
  commit(i) { P.FPDFPage_GenerateContent(this.page(i)); }

  size(i) { const pg = this.page(i); return [P.FPDF_GetPageWidthF(pg), P.FPDF_GetPageHeightF(pg)]; }
  mediaBox(i) { return readFloats(4, (p) => P.FPDFPage_GetMediaBox(this.page(i), p, p + 4, p + 8, p + 12)); } // l, b, r, t

  save() {
    for (const i of this.pages.keys()) P.FPDFPage_GenerateContent(this.page(i));
    const w = P.PDFiumExt_OpenFileWriter();
    try {
      if (!P.PDFiumExt_SaveAsCopy(this.h, w)) throw new Error("PDFium could not save the document");
      const n = P.PDFiumExt_GetFileWriterSize(w), out = malloc(n);
      P.PDFiumExt_GetFileWriterData(w, out, n);
      const bytes = heap().slice(out, out + n);
      free(out);
      return bytes;
    } finally { P.PDFiumExt_CloseFileWriter(w); }
  }

  close() {
    this.releasePages();
    if (this.form) { P.PDFiumExt_ExitFormFillEnvironment(this.form); this.form = 0; }
    if (this.formInfo) { P.PDFiumExt_CloseFormFillInfo(this.formInfo); this.formInfo = 0; }
    if (this.h) P.FPDF_CloseDocument(this.h);
    free(this.dataPtr);
    this.h = this.dataPtr = 0;
  }
}

/** Open → fn(doc) → save → close. Returns the new bytes. */
export async function transform(bytes, password, fn) {
  const doc = await PdfDoc.open(bytes, password);
  try { const r = await fn(doc); return r instanceof Uint8Array ? r : doc.save(); } finally { doc.close(); }
}

export const pdfium = () => P;
