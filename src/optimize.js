// Structural PDF optimisation (the part of "Reduce file size" that is not about images):
// removes duplicate copies of fonts and images, strips font data that PDF viewers never use,
// recompresses uncompressed data, drops unused objects and writes compact object streams.
// Encrypted documents are left as they are.

let lib;
const load = () => (lib ||= import("./vendor/pdf-lib/pdf-lib.esm.min.js"));

// Font tables that are never used when a PDF is displayed or printed: embedded bitmaps, digital
// signatures of the font file, device metrics and OpenType layout (the PDF already positions every glyph).
const DROP = new Set(["EBDT", "EBLC", "EBSC", "CBDT", "CBLC", "sbix", "DSIG", "meta", "hdmx", "VDMX", "LTSH", "PCLT",
  "GPOS", "GSUB", "GDEF", "BASE", "JSTF", "MATH", "kern", "morx", "mort", "kerx", "feat", "trak", "prop", "Zapf"]);

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const tagOf = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function checksum(b, off, len) {
  let sum = 0;
  for (let i = 0; i < len; i += 4) sum = (sum + (((b[off + i] << 24) | ((b[off + i + 1] || 0) << 16) | ((b[off + i + 2] || 0) << 8) | (b[off + i + 3] || 0)) >>> 0)) >>> 0;
  return sum;
}

/** Keeps only the font's family/style/full/version/PostScript names (IDs 1–6); drops licence texts, URLs and translations. */
function slimNames(t) {
  if (t.length < 6 || u16(t, 0) !== 0) return null;
  const count = u16(t, 2), strOff = u16(t, 4);
  if (6 + count * 12 > t.length) return null;
  const keep = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, platform = u16(t, r), lang = u16(t, r + 4), id = u16(t, r + 6), len = u16(t, r + 8), off = u16(t, r + 10);
    if (id < 1 || id > 6 || strOff + off + len > t.length) continue;
    if ((platform === 3 && lang === 0x409) || (platform === 1 && lang === 0) || platform === 0) keep.push({ r, len, off });
  }
  if (!keep.length || keep.length === count) return null;
  const head = 6 + keep.length * 12;
  const out = new Uint8Array(head + keep.reduce((a, k) => a + k.len, 0)), dv = new DataView(out.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, keep.length); dv.setUint16(4, head);
  let pos = 0;
  keep.forEach((k, i) => {
    out.set(t.subarray(k.r, k.r + 8), 6 + i * 12);
    dv.setUint16(6 + i * 12 + 8, k.len); dv.setUint16(6 + i * 12 + 10, pos);
    out.set(t.subarray(strOff + k.off, strOff + k.off + k.len), head + pos);
    pos += k.len;
  });
  return out;
}

/** Rebuilds a TrueType/OpenType font without the tables in DROP. Returns null when nothing changes. */
export function stripFont(font) {
  if (font.length < 12) return null;
  const ver = u32(font, 0);
  if (ver !== 0x00010000 && ver !== 0x4f54544f && ver !== 0x74727565) return null; // not a single sfnt font
  const n = u16(font, 4);
  if (12 + n * 16 > font.length) return null;
  const tables = [];
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16, tag = tagOf(font, r), off = u32(font, r + 8), len = u32(font, r + 12);
    if (off + len > font.length) return null;
    if (DROP.has(tag)) continue;
    const data = font.subarray(off, off + len);
    tables.push({ tag, data: (tag === "name" && slimNames(data)) || data });
  }
  if (!tables.some((x) => x.tag === "head")) return null;
  if (tables.length === n && tables.every((x) => x.data.buffer === font.buffer)) return null;
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const m = tables.length, headerLen = 12 + m * 16;
  let size = headerLen;
  for (const x of tables) size += (x.data.length + 3) & ~3;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let es = 0; while (1 << (es + 1) <= m) es++;
  dv.setUint32(0, ver); dv.setUint16(4, m); dv.setUint16(6, (1 << es) * 16); dv.setUint16(8, es); dv.setUint16(10, m * 16 - (1 << es) * 16);
  let pos = headerLen, headAt = -1;
  tables.forEach((x, i) => {
    const len = x.data.length;
    out.set(x.data, pos);
    if (x.tag === "head" && len >= 12) { headAt = pos; dv.setUint32(pos + 8, 0); }
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = x.tag.charCodeAt(k);
    dv.setUint32(r + 4, checksum(out, pos, len)); dv.setUint32(r + 8, pos); dv.setUint32(r + 12, len);
    pos += (len + 3) & ~3;
  });
  if (headAt >= 0) dv.setUint32(headAt + 8, (0xb1b0afba - checksum(out, 0, size)) >>> 0);
  return out.length < font.length ? out : null;
}

function hashBytes(b) {
  let h = 0x811c9dc5;
  const step = b.length > 65536 ? 7 : 1; // large streams: sampled hash, equality is checked byte by byte
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 0x01000193);
  return (h >>> 0).toString(36) + ":" + b.length;
}
const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/**
 * Returns smaller PDF bytes, or null when the document cannot be optimised (encrypted, unreadable).
 * strong: also removes the accessibility structure (tags), the XMP metadata and page thumbnails.
 */
export async function optimizePdf(bytes, { strong = false } = {}) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream, PDFNumber, decodePDFRawStream } = await load();
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }); }
  catch { return null; }
  if (pdf.isEncrypted) return null;
  const ctx = pdf.context;
  const N = (s) => PDFName.of(s);
  const filterOf = (s) => { const f = s.dict.get(N("Filter")); return f instanceof PDFArray ? (f.size() === 1 ? f.get(0) : f) : f; };
  const isFlate = (s) => { const f = filterOf(s); return f === N("FlateDecode") && !s.dict.get(N("DecodeParms")); };

  // 1. fonts: drop unused tables
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(N("Type")) !== N("FontDescriptor")) continue;
    for (const key of ["FontFile2", "FontFile3"]) {
      const ref = obj.get(N(key));
      if (!(ref instanceof PDFRef)) continue;
      const s = ctx.lookup(ref);
      if (!(s instanceof PDFRawStream) || (filterOf(s) && !isFlate(s))) continue;
      if (key === "FontFile3" && s.dict.get(N("Subtype")) !== N("OpenType")) continue;
      let raw;
      try { raw = filterOf(s) ? decodePDFRawStream(s).decode() : s.contents; } catch { continue; }
      const slim = stripFont(raw);
      if (!slim) continue;
      const extra = {};
      for (const [k, v] of s.dict.entries()) if (![N("Length"), N("Filter"), N("DecodeParms"), N("Length1")].includes(k)) extra[k.asString().slice(1)] = v;
      if (key === "FontFile2") extra.Length1 = slim.length;
      ctx.assign(ref, ctx.flateStream(slim, extra));
    }
  }

  // 2. compress streams that are stored uncompressed (page contents, fonts, forms)
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || filterOf(obj) || obj.contents.length < 256) continue;
    const type = obj.dict.get(N("Type"));
    if (type === N("Metadata") || type === N("XRef") || type === N("ObjStm")) continue;
    const extra = {};
    for (const [k, v] of obj.dict.entries()) if (k !== N("Length")) extra[k.asString().slice(1)] = v;
    const z = ctx.flateStream(obj.contents, extra);
    if (z.contents.length < obj.contents.length * 0.9) ctx.assign(ref, z);
  }

  // 3. strong: remove tags, XMP metadata, thumbnails and editing leftovers
  if (strong) {
    const cat = pdf.catalog;
    for (const k of ["StructTreeRoot", "MarkInfo", "Metadata", "PieceInfo", "SpiderInfo", "Threads"]) cat.delete(N(k));
    for (const page of pdf.getPages()) for (const k of ["StructParents", "PieceInfo", "Thumb", "Metadata"]) page.node.delete(N(k));
  }

  // 4. merge identical streams (the same font or image embedded several times)
  const byHash = new Map(), alias = new Map();
  const dictKey = (s) => [...s.dict.entries()].filter(([k]) => k !== N("Length")).map(([k, v]) => k.toString() + v.toString()).sort().join();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.contents.length < 512) continue;
    const type = obj.dict.get(N("Type"));
    if (type === N("XRef") || type === N("ObjStm")) continue;
    const key = hashBytes(obj.contents);
    const list = byHash.get(key) || [];
    const twin = list.find((x) => sameBytes(x.obj.contents, obj.contents) && x.dk === dictKey(obj));
    if (twin) alias.set(ref.toString(), twin.ref); else { list.push({ ref, obj, dk: dictKey(obj) }); byHash.set(key, list); }
  }
  const swap = (v) => {
    if (v instanceof PDFRef) return alias.get(v.toString()) || v;
    if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) v.set(i, swap(v.get(i))); return v; }
    if (v instanceof PDFDict) { for (const [k, x] of v.entries()) v.set(k, swap(x)); return v; }
    if (v instanceof PDFStream) { swap(v.dict); return v; }
    return v;
  };
  if (alias.size) for (const [, obj] of ctx.enumerateIndirectObjects()) swap(obj);

  // 5. keep only what the document still uses
  const keep = new Set(), todo = [];
  const visit = (v) => {
    if (v instanceof PDFRef) { const k = v.toString(); if (!keep.has(k)) { keep.add(k); todo.push(ctx.lookup(v)); } }
    else if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) visit(v.get(i));
    else if (v instanceof PDFDict) for (const [, x] of v.entries()) visit(x);
    else if (v instanceof PDFStream) visit(v.dict);
  };
  visit(ctx.trailerInfo.Root); visit(ctx.trailerInfo.Info);
  while (todo.length) visit(todo.pop());
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!keep.has(ref.toString())) ctx.delete(ref);

  const out = await pdf.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: Infinity });
  return out.length < bytes.length ? out : null;
}
