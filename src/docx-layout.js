// PDF → Word with real Word structure that keeps the look of the PDF.
// • Text becomes normal paragraphs (no text boxes); lines of prose are joined into paragraphs.
// • Text in columns becomes Word tables, one cell per column, so a column can be selected on its own.
// • Boxes and lines of the PDF become the borders of those table cells, and grey bands their shading.
// • Vertical gaps are kept with paragraph spacing, so every line stays at its height on the page.
// • Anything else (logos, photos, drawings) is placed as a picture behind the text, where it was.

import { PdfDoc, pdfium, malloc, free, M, heap, readFloats } from "./pdfium.js";
import { makeZip } from "./zip.js";

const TEXT = 1, PATH = 2;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
const tw = (pt) => Math.max(0, Math.round(pt * 20)); // twips
const twSigned = (pt) => Math.round(pt * 20);
const emu = (pt) => Math.round(pt * 12700);
const hex = (c) => c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
const ASC = 0.8, LINE = 1.17; // Word puts the baseline of an exact-height line about 80 % down; line = 1.17 × size

/* ------------------------------------------------------------------ fonts */

/** "ABCDEF+TimesNewRomanPS-BoldItalicMT" → { family: "Times New Roman", bold, italic } */
export function wordFont(base, weight, flags) {
  let n = (base || "").replace(/^[A-Z]{6}\+/, "");
  const style = n.match(/[-,_ ](.*)$/)?.[1] || "";
  const bold = /bold|black|heavy|semibold|demi/i.test(style) || /bold/i.test(n) || weight >= 600 || !!(flags & 262144);
  const italic = /italic|oblique/i.test(n) || !!(flags & 64);
  n = n.replace(/[-,_].*$/, "").replace(/(PSMT|PS|MT|Std|Pro|LT)$/g, "");
  const known = { helvetica: "Arial", arial: "Arial", times: "Times New Roman", timesroman: "Times New Roman", timesnewroman: "Times New Roman",
    courier: "Courier New", couriernew: "Courier New", symbol: "Symbol", zapfdingbats: "Wingdings", calibri: "Calibri", cambria: "Cambria",
    verdana: "Verdana", tahoma: "Tahoma", georgia: "Georgia", segoeui: "Segoe UI", garamond: "Garamond", centurygothic: "Century Gothic" };
  const key = n.toLowerCase().replace(/[^a-z]/g, "");
  return { family: known[key] || n.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Arial", bold, italic };
}

const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function measure(text, f, size) {
  if (!measureCtx || !text) return 0;
  measureCtx.font = `${f.italic ? "italic " : ""}${f.bold ? "700 " : "400 "}${size}px "${f.family}", Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

/* ------------------------------------------------------------------ reading a page */

function readText(fn) {
  const len = fn(0, 0);
  if (len <= 2) return "";
  const p = malloc(len);
  try { fn(p, len); return M().UTF16ToString(p); } finally { free(p); }
}
function readAscii(fn) {
  const len = fn(0, 0);
  if (len <= 1) return "";
  const p = malloc(len);
  try { fn(p, len); return M().UTF8ToString(p); } finally { free(p); }
}
function readColor(P, fn, o) {
  const c = malloc(16);
  try { return fn(o, c, c + 4, c + 8, c + 12) ? [0, 4, 8, 12].map((i) => M().getValue(c + i, "i32")) : null; } finally { free(c); }
}

/** Page point → display point (top-left origin, page rotation applied), in PDF points. */
function mapper(P, pg, W, H) {
  const K = 64;
  return (x, y) => {
    const ip = malloc(8);
    try {
      P.FPDF_PageToDevice(pg, 0, 0, Math.round(W * K), Math.round(H * K), 0, x, y, ip, ip + 4);
      return [M().getValue(ip, "i32") / K, M().getValue(ip + 4, "i32") / K];
    } finally { free(ip); }
  };
}

/** Takes the text, lines, boxes and shaded areas out of the page; what is left is drawn as a picture. */
function readPage(P, pg, W, H) {
  const toView = mapper(P, pg, W, H), tp = P.FPDFText_LoadPage(pg);
  const runs = [], hrules = [], vrules = [], fills = [], taken = [], shapes = [];
  // where the visible characters of each text object really are (PDFs often pad text with spaces)
  const ink = new Map(), cb = malloc(32);
  for (let i = 0, n = P.FPDFText_CountChars(tp); i < n; i++) {
    const u = P.FPDFText_GetUnicode(tp, i);
    if (u <= 32 || u === 0xa0 || !P.FPDFText_GetCharBox(tp, i, cb, cb + 8, cb + 16, cb + 24)) continue;
    const o = P.FPDFText_GetTextObject(tp, i);
    if (!o) continue;
    const l = M().getValue(cb, "double"), r = M().getValue(cb + 8, "double"), y = M().getValue(cb + 16, "double");
    const [a] = toView(l, y), [b] = toView(r, y);
    const e = ink.get(o);
    if (e) { e.l = Math.min(e.l, a, b); e.r = Math.max(e.r, a, b); } else ink.set(o, { l: Math.min(a, b), r: Math.max(a, b) });
  }
  free(cb);
  const box = (o) => {
    const b = readFloats(4, (p) => P.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12));
    if (!b) return null;
    const [x0, y0] = toView(b[0], b[1]), [x1, y1] = toView(b[2], b[3]);
    return { l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) };
  };
  const n = P.FPDFPage_CountObjects(pg);
  for (let k = 0; k < n; k++) {
    const o = P.FPDFPage_GetObject(pg, k), type = P.FPDFPageObj_GetType(o);
    if (type === TEXT) {
      if (P.FPDFTextObj_GetTextRenderMode(o) === 3) continue; // invisible text of scanned pages
      const m = readFloats(6, (p) => P.FPDFPageObj_GetMatrix(o, p)), fs = readFloats(1, (p) => P.FPDFTextObj_GetFontSize(o, p));
      if (!m || !fs) continue;
      const [x0, y0] = toView(m[4], m[5]), [x1, y1] = toView(m[4] + m[0], m[5] + m[1]);
      if (x1 - x0 <= 0 || Math.abs(y1 - y0) > Math.abs(x1 - x0) * 0.05) continue; // rotated text stays in the picture
      const size = fs[0] * Math.hypot(m[2], m[3]);
      if (!(size > 1 && size < 400)) continue;
      const raw = readText((p, l) => P.FPDFTextObj_GetText(o, tp, p, l)).replace(/\r?\n/g, " ");
      const font = P.FPDFTextObj_GetFont(o);
      const f = wordFont(readAscii((p, l) => P.FPDFFont_GetBaseFontName(font, p, l)), P.FPDFFont_GetWeight(font), P.FPDFFont_GetFlags(font));
      const text = raw.trim();
      taken.push(o);
      if (!text) continue;
      // Measure the visible words: forms (SAP and others) pad text with spaces, so the PDF's own box is too wide.
      let x, right;
      const e = ink.get(o);
      if (e && e.r > e.l) { x = e.l; right = e.r; }
      else {
        const lead = measure(raw.match(/^\s*/)[0], f, size), width = measure(text, f, size);
        x = x0 + lead; right = x + width;
        if (!width) { const bb = box(o); x = x0; right = bb ? Math.max(bb.r, x0) : x0; }
      }
      const c = readColor(P, P.FPDFPageObj_GetFillColor, o) || [0, 0, 0, 255];
      runs.push({ text, x, y: y0, right, size, ...f, color: hex(c.slice(0, 3)) });
    } else if (type === PATH && P.FPDFPath_CountSegments(o) <= 6) {
      const bb = box(o);
      if (!bb) continue;
      const mode = malloc(8);
      P.FPDFPath_GetDrawMode(o, mode, mode + 4);
      const filled = M().getValue(mode, "i32") > 0, stroked = M().getValue(mode + 4, "i32") > 0;
      free(mode);
      const sc = readColor(P, P.FPDFPageObj_GetStrokeColor, o), fc = readColor(P, P.FPDFPageObj_GetFillColor, o);
      const sw = readFloats(1, (p) => P.FPDFPageObj_GetStrokeWidth(o, p))?.[0] || 1;
      const w = bb.r - bb.l, h = bb.b - bb.t;
      const isWhite = (c) => !c || c[3] === 0 || (c[0] > 245 && c[1] > 245 && c[2] > 245);
      const lineColor = stroked && sc ? sc : fc;
      const shape = { o, ...bb };
      if (h <= 2.6 && w >= 3) { if (!isWhite(lineColor)) { hrules.push({ y: (bb.t + bb.b) / 2, l: bb.l, r: bb.r, w: Math.max(0.25, stroked ? sw : h), c: hex(lineColor.slice(0, 3)) }); shapes.push(shape); } }
      else if (w <= 2.6 && h >= 3) { if (!isWhite(lineColor)) { vrules.push({ x: (bb.l + bb.r) / 2, t: bb.t, b: bb.b, w: Math.max(0.25, stroked ? sw : w), c: hex(lineColor.slice(0, 3)) }); shapes.push(shape); } }
      else if (w >= 3 && h >= 3) {
        if (filled && !isWhite(fc)) fills.push({ ...bb, c: hex(fc.slice(0, 3)) });
        if (stroked && sc && !isWhite(sc)) {
          const e = { w: Math.max(0.25, sw), c: hex(sc.slice(0, 3)) };
          hrules.push({ y: bb.t, l: bb.l, r: bb.r, ...e }, { y: bb.b, l: bb.l, r: bb.r, ...e });
          vrules.push({ x: bb.l, t: bb.t, b: bb.b, ...e }, { x: bb.r, t: bb.t, b: bb.b, ...e });
        }
        if ((filled && !isWhite(fc)) || (stroked && sc && !isWhite(sc))) shapes.push(shape);
      }
    }
  }
  P.FPDFText_ClosePage(tp);
  for (const o of taken) if (P.FPDFPage_RemoveObject(pg, o)) P.FPDFPageObj_Destroy(o);
  return { runs, hrules, vrules, fills, shapes };
}

/** What is left on the page (logos, photos, drawings), cropped to where it is. */
async function leftovers(P, pg, W, H, form) {
  const scale = 2.5, w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const bmp = P.FPDFBitmap_Create(w, h, 0);
  try {
    P.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
    P.FPDF_RenderPageBitmap(bmp, pg, 0, 0, w, h, 0, 0x01 | 0x800);
    if (form) P.FPDF_FFLDraw(form, bmp, pg, 0, 0, w, h, 0, 0x01 | 0x800);
    const buf = P.FPDFBitmap_GetBuffer(bmp), stride = P.FPDFBitmap_GetStride(bmp), src = heap();
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = buf + y * stride;
      for (let x = 0; x < w; x++) {
        const s = row + x * 4;
        if (src[s] < 248 || src[s + 1] < 248 || src[s + 2] < 248) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, img = new ImageData(cw, ch), d = img.data;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const s = buf + (y + y0) * stride + (x + x0) * 4, o = (y * cw + x) * 4;
      d[o] = src[s + 2]; d[o + 1] = src[s + 1]; d[o + 2] = src[s];
      d[o + 3] = src[s] > 250 && src[s + 1] > 250 && src[s + 2] > 250 ? 0 : 255; // white becomes see-through
    }
    const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
    cv.getContext("2d").putImageData(img, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    return { png: new Uint8Array(await blob.arrayBuffer()), x: x0 / scale, y: y0 / scale, w: cw / scale, h: ch / scale };
  } finally { P.FPDFBitmap_Destroy(bmp); }
}

/* ------------------------------------------------------------------ layout analysis */

/** Text pieces → rows (same baseline) → segments (words that belong together). Vertical lines split segments. */
function rowsOf(runs, vrules) {
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const r of runs) {
    const row = rows.find((w) => Math.abs(w.y - r.y) < Math.min(w.size, r.size) * 0.35);
    if (row) { row.runs.push(r); row.size = Math.max(row.size, r.size); } else rows.push({ y: r.y, size: r.size, runs: [r] });
  }
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
    row.segs = [];
    let seg = null;
    for (const r of row.runs) {
      const gap = seg ? r.x - seg.right : Infinity;
      const cut = seg && vrules.some((v) => v.x > seg.right - 0.5 && v.x < r.x + 0.5 && v.t < row.y && v.b > row.y - row.size * 0.7);
      if (seg && !cut && gap < Math.max(seg.size, r.size) * 1.6 && gap > -Math.max(seg.size, r.size)) {
        if (gap > r.size * 0.12) seg.runs[seg.runs.length - 1].text += " ";
        seg.runs.push({ ...r }); seg.right = Math.max(seg.right, r.right); seg.size = Math.max(seg.size, r.size);
      } else {
        seg = { x: r.x, right: r.right, size: r.size, runs: [{ ...r }] };
        row.segs.push(seg);
      }
    }
    for (const s of row.segs) for (const r of s.runs) r.text = r.text.replace(/\s{2,}/g, " ");
    row.top = row.y - row.size * 0.78; row.bottom = row.y + row.size * 0.24;
    row.left = row.segs[0].x; row.right = Math.max(...row.segs.map((s) => s.right));
  }
  rows.sort((a, b) => a.y - b.y);
  return rows;
}

/** Areas that become tables: boxes and groups of lines/shading, joined when they sit side by side. */
function regionsOf(hrules, vrules, fills, rows, W) {
  const cands = [];
  for (const f of fills) cands.push({ l: f.l, r: f.r, t: f.t, b: f.b });
  // boxes: a vertical line meeting horizontal lines at both ends
  for (const v of vrules) cands.push({ l: v.x, r: v.x, t: v.t, b: v.b, v: true });
  // ruled lists: two or more horizontal lines of about the same width close to each other
  const hs = [...hrules].sort((a, b) => a.y - b.y);
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const a = hs[i], b = hs[j];
    if (b.y - a.y > 60) break;
    if (Math.abs(a.l - b.l) < 4 && Math.abs(a.r - b.r) < 4 && b.y - a.y > 3) cands.push({ l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: a.y, b: b.y });
  }
  // merge everything that overlaps vertically (side-by-side boxes become one table)
  cands.sort((a, b) => a.t - b.t);
  const regs = [];
  for (const c of cands) {
    const g = regs.find((r) => c.t < r.b - 1 && c.b > r.t + 1);
    if (g) { g.l = Math.min(g.l, c.l); g.r = Math.max(g.r, c.r); g.t = Math.min(g.t, c.t); g.b = Math.max(g.b, c.b); }
    else regs.push({ ...c });
  }
  // a merge can make new overlaps
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < regs.length && !changed; i++) for (let j = i + 1; j < regs.length && !changed; j++) {
      const a = regs[i], b = regs[j];
      if (b.t < a.b - 1 && b.b > a.t + 1) { Object.assign(a, { l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: Math.min(a.t, b.t), b: Math.max(a.b, b.b) }); regs.splice(j, 1); changed = true; }
    }
  }
  // keep areas that hold text in columns or more than one row, or that are boxes
  return regs.filter((g) => g.r - g.l > 20 && rows.some((r) => r.y > g.t && r.y < g.b + 1)).sort((a, b) => a.t - b.t);
}

/** Column edges for a group of rows: lines inside the area plus gaps that are empty in every row. */
function columnsOf(rows, vrules, l, r) {
  const edges = [l, r];
  for (const v of vrules) if (v.x > l + 2 && v.x < r - 2 && rows.some((row) => v.t < row.y && v.b > row.top)) edges.push(v.x);
  // whitespace gaps common to all rows
  const steps = Math.max(1, Math.ceil(r - l));
  const used = new Uint8Array(steps + 1);
  for (const row of rows) for (const s of row.segs) for (let x = Math.floor(s.x - l); x <= Math.ceil(s.right - l); x++) if (x >= 0 && x <= steps) used[x] = 1;
  let start = -1;
  for (let x = 0; x <= steps; x++) {
    if (!used[x] && start < 0) start = x;
    if ((used[x] || x === steps) && start >= 0) {
      const end = used[x] ? x : x + 1;
      if (start > 0 && end <= steps && end - start >= 6) {
        const a = l + start, b = l + end;
        if (!edges.some((e) => e > a - 1 && e < b + 1)) edges.push((a + b) / 2);
      }
      start = -1;
    }
  }
  edges.sort((a, b) => a - b);
  return edges.filter((e, i) => i === 0 || e - edges[i - 1] > 2.5);
}

/* ------------------------------------------------------------------ Word XML */

function runXml(r) {
  const f = esc(r.family), sz = Math.round(r.size * 2);
  return `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>${r.bold ? "<w:b/><w:bCs/>" : ""}${r.italic ? "<w:i/><w:iCs/>" : ""}${r.color !== "000000" ? `<w:color w:val="${r.color}"/>` : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}
const pXml = ({ before = 0, line, left = 0, right = 0, jc = "left", runs = "", keep = false }) =>
  `<w:p><w:pPr>${keep ? "<w:keepNext/>" : ""}<w:spacing w:before="${tw(before)}" w:after="0" w:line="${Math.max(20, tw(line))}" w:lineRule="exact"/><w:ind w:left="${tw(left)}" w:right="${twSigned(right)}"/><w:jc w:val="${jc}"/></w:pPr>${runs}</w:p>`;
const spacer = (h, extra = "") => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, tw(h))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${extra}</w:p>`;

/** Prose: consecutive single-column lines with the same left edge and spacing become one paragraph. */
function paragraphs(rows, W) {
  const out = [];
  for (const row of rows) {
    const seg = row.segs[0], prev = out[out.length - 1];
    const pitch = prev ? row.y - prev.lastY : 0;
    let joinable = prev && row.segs.length === 1 && prev.single && Math.abs(prev.x - seg.x) < 2 && Math.abs(prev.size - row.size) < 0.6
      && pitch > row.size * 0.9 && pitch < row.size * 1.8 && (!prev.pitch || Math.abs(prev.pitch - pitch) < 1.2);
    if (joinable) {
      // a line broke because it was full: the next line's first word did not fit at its end
      const r0 = seg.runs[0], word = (r0.text.match(/^\S+/) || [""])[0];
      const colRight = Math.max(prev.maxRight, seg.right);
      const fits = measure(word + " ", r0, r0.size) || word.length * r0.size * 0.5;
      joinable = colRight - prev.lastRight < fits + r0.size * 0.3 && colRight - prev.x > W * 0.3;
    }
    if (joinable) {
      const last = prev.runs[prev.runs.length - 1];
      if (!/-$/.test(last.text)) last.text += " ";
      prev.runs.push(...seg.runs); prev.lines++; prev.pitch = pitch; prev.lastY = row.y; prev.lastRight = seg.right; prev.maxRight = Math.max(prev.maxRight, seg.right);
    } else out.push({ firstY: row.y, lastY: row.y, x: seg.x, size: row.size, runs: [...seg.runs], lines: 1, single: row.segs.length === 1, lastRight: seg.right, maxRight: seg.right, row });
  }
  return out;
}

function tableXml(rows, reg, hrules, vrules, fills, W) {
  const edges = columnsOf(rows, vrules, reg.l, reg.r), ncol = edges.length - 1;
  const mar = 1.4; // cell padding left/right, pt
  // row bands: from the area's top to its bottom, split half-way between rows
  const bounds = [Math.min(reg.t, rows[0].top - 1)];
  for (let i = 1; i < rows.length; i++) bounds.push((rows[i - 1].bottom + rows[i].top) / 2);
  bounds.push(Math.max(reg.b, rows[rows.length - 1].bottom + 1));
  // horizontal lines sit on the nearest band edge; vertical lines on the nearest column edge
  const hAt = bounds.map(() => []), vAt = edges.map(() => []);
  for (const h of hrules) {
    if (h.y < bounds[0] - 3 || h.y > bounds[bounds.length - 1] + 3 || h.r < reg.l || h.l > reg.r) continue;
    let k = 0; for (let i = 1; i < bounds.length; i++) if (Math.abs(bounds[i] - h.y) < Math.abs(bounds[k] - h.y)) k = i;
    hAt[k].push(h);
  }
  for (const v of vrules) {
    let k = 0; for (let i = 1; i < edges.length; i++) if (Math.abs(edges[i] - v.x) < Math.abs(edges[k] - v.x)) k = i;
    if (Math.abs(edges[k] - v.x) < 4) vAt[k].push(v);
  }
  const border = (side, list) => {
    if (!list) return `<w:${side} w:val="nil"/>`;
    return `<w:${side} w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(list.w * 8)))}" w:space="0" w:color="${list.c}"/>`;
  };
  const hFind = (k, l, r) => hAt[k].find((h) => Math.min(h.r, r) - Math.max(h.l, l) > (r - l) * 0.5);
  const vFind = (k, t, b) => vAt[k].find((v) => Math.min(v.b, b) - Math.max(v.t, t) > (b - t) * 0.5);
  const fillFind = (l, r, t, b) => fills.find((f) => f.l <= (l + r) / 2 + 1 && f.r >= (l + r) / 2 - 1 && f.t <= (t + b) / 2 + 1 && f.b >= (t + b) / 2 - 1);

  // which column each segment starts and ends in
  const colOf = (x) => { let k = 0; while (k < ncol - 1 && x >= edges[k + 1] - 0.5) k++; return k; };
  const bandRows = [];
  // optional empty band above the first text row (box top) and below the last one (box bottom)
  const all = [];
  rows.forEach((row, i) => all.push({ row, t: bounds[i], b: bounds[i + 1], k: i }));
  let xml = "";
  const grid = edges.slice(1).map((e, i) => `<w:gridCol w:w="${tw(e - edges[i])}"/>`).join("");
  for (const { row, t, b, k } of all) {
    const cells = Array.from({ length: ncol }, () => []);
    for (const s of row.segs) cells[colOf((s.x + s.x) / 2 + 0.1)].push(s);
    // a segment that runs into the next columns (nothing else there) spans them
    const span = new Array(ncol).fill(1), skip = new Array(ncol).fill(false);
    for (let c = 0; c < ncol; c++) {
      if (skip[c] || !cells[c].length) continue;
      const end = Math.max(...cells[c].map((s) => s.right));
      let e = c;
      while (e + 1 < ncol && end > edges[e + 1] + 1 && !cells[e + 1].length && !vFind(e + 1, t, b)) { e++; skip[e] = true; }
      span[c] = e - c + 1;
    }
    let tr = "";
    for (let c = 0; c < ncol; c++) {
      if (skip[c]) continue;
      const l = edges[c], r = edges[c + span[c]];
      const top = hFind(k, l, r), bottom = hFind(k + 1, l, r), left = vFind(c, t, b), right = vFind(c + span[c], t, b);
      const fill = fillFind(l, r, t, b);
      const segs = cells[c];
      let para;
      if (segs.length) {
        const line = row.size * LINE, before = Math.max(0, Math.min(row.y - ASC * line - t, b - t - line));
        const sx = segs[0].x, ex = Math.max(...segs.map((s) => s.right));
        const runs = segs.flatMap((s, i) => (i ? [{ ...s.runs[0], text: " " }, ...s.runs] : s.runs));
        // alignment: numbers that end at the column's right side are right-aligned; centred text stays centred
        const roomL = sx - l, roomR = r - ex;
        let jc = "left", left_ = Math.max(0, roomL - mar), right_ = 0;
        if (roomR < roomL * 0.35 && roomL > 12) { jc = "right"; left_ = 0; right_ = Math.max(0, roomR - mar); }
        else if (Math.abs(roomL - roomR) < 3 && roomL > 8) { jc = "center"; left_ = 0; }
        para = pXml({ before, line, left: left_, right: right_, jc, runs: runs.map(runXml).join("") });
      } else para = spacer(1);
      tr += `<w:tc><w:tcPr><w:tcW w:w="${tw(r - l)}" w:type="dxa"/>${span[c] > 1 ? `<w:gridSpan w:val="${span[c]}"/>` : ""}<w:tcBorders>${border("top", top)}${border("left", left)}${border("bottom", bottom)}${border("right", right)}</w:tcBorders>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill.c}"/>` : ""}</w:tcPr>${para}</w:tc>`;
    }
    xml += `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${Math.max(20, tw(b - t))}" w:hRule="exact"/></w:trPr>${tr}</w:tr>`;
    bandRows.push(row);
  }
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="${tw(edges[ncol] - edges[0])}" w:type="dxa"/><w:tblInd w:w="${tw(edges[0])}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${tw(mar)}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="${tw(mar)}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${xml}</w:tbl>`;
  return { xml: tbl, top: bounds[0], bottom: bounds[bounds.length - 1] };
}

/** One page → body XML (paragraphs and tables in reading order, with the gaps between them). */
function pageXml(page, W, H) {
  const { runs, hrules, vrules, fills } = page;
  const rows = rowsOf(runs, vrules);
  const regs = regionsOf(hrules, vrules, fills, rows, W);
  const items = [];
  const used = new Set();
  for (const g of regs) {
    const inside = rows.filter((r) => !used.has(r) && r.y > g.t - 0.5 && r.y < g.b + r.size * 0.3);
    if (!inside.length) continue;
    inside.forEach((r) => used.add(r));
    const l = Math.min(g.l, ...inside.map((r) => r.left)), rr = Math.max(g.r, ...inside.map((r) => r.right));
    items.push({ kind: "table", top: Math.min(g.t, inside[0].top), rows: inside, reg: { ...g, l, r: rr } });
  }
  // text outside the areas: columns of text become borderless tables, the rest paragraphs
  const free = rows.filter((r) => !used.has(r));
  let i = 0;
  while (i < free.length) {
    if (free[i].segs.length > 1) {
      const group = [free[i]];
      while (i + group.length < free.length) {
        const nx = free[i + group.length], pv = group[group.length - 1];
        if (nx.segs.length < 2 && !(nx.segs.length === 1 && group.length > 1)) break;
        if (nx.y - pv.y > Math.max(nx.size, pv.size) * 2.6) break;
        if (items.some((it) => it.kind === "table" && it.top > pv.y && it.top < nx.y)) break;
        group.push(nx);
      }
      while (group.length > 1 && group[group.length - 1].segs.length < 2) group.pop();
      const l = Math.min(...group.map((r) => r.left)), r = Math.max(...group.map((r) => r.right));
      items.push({ kind: "table", top: group[0].top, rows: group, reg: { l: l - 1.5, r: Math.min(W, r + 3), t: group[0].top - 1, b: group[group.length - 1].bottom + 1 } });
      i += group.length;
    } else {
      const start = i;
      while (i < free.length && free[i].segs.length === 1) i++;
      for (const p of paragraphs(free.slice(start, i), W)) items.push({ kind: "para", top: p.firstY - ASC * p.size * LINE, p });
    }
  }
  items.sort((a, b) => a.top - b.top);
  const parts = [];
  let y = 1, lastWasTable = false; // the page starts with a 1 pt paragraph that holds the picture
  items.forEach((it, k) => { it.next = items[k + 1]?.top ?? H; });
  for (const it of items) {
    if (it.kind === "para") {
      const p = it.p;
      // tightly set lines (e.g. letterheads) keep their spacing: the line is never taller than the room to the next one
      let line = p.lines > 1 ? p.pitch : p.size * LINE;
      if (p.lines === 1) line = Math.max(p.size * 0.95, Math.min(line, it.next - it.top));
      const top = p.firstY - ASC * line;
      // the paragraph keeps the width it has in the PDF so it wraps where the PDF wraps
      // a single line never wraps: if it runs to (or past) the page edge, the indent reaches past it too
      const right = p.lines > 1 ? Math.max(0, W - p.maxRight - 2) : Math.min(0, W - p.maxRight - p.size * 3);
      parts.push(pXml({ before: Math.max(0, top - y), line, left: Math.max(0, p.x), right, runs: p.runs.map(runXml).join("") }));
      y = Math.max(y, top) + line * p.lines;
      lastWasTable = false;
    } else {
      const t = tableXml(it.rows, it.reg, hrules, vrules, fills, W);
      it.area = { l: it.reg.l, r: it.reg.r, t: t.top, b: t.bottom };
      // tables need a paragraph between them (otherwise Word joins them); it also carries the gap above
      const gap = t.top - y;
      if (gap > 0.6 || lastWasTable) { parts.push(spacer(Math.max(1, gap))); y += Math.max(1, gap); }
      parts.push(t.xml);
      y = Math.max(y, t.bottom);
      lastWasTable = true;
    }
  }
  return { xml: parts.join(""), areas: items.filter((it) => it.kind === "table").map((it) => it.area) };
}

function picture(id, rid, x, y, w, h) {
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(y)}</wp:posOffset></wp:positionV><wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="picture${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

const sect = (W, H) => `<w:sectPr><w:pgSz w:w="${tw(W)}" w:h="${tw(H)}"${W > H ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

/** PDF bytes → .docx bytes: Word paragraphs and tables laid out like the PDF. */
export async function layoutDocx(bytes, password, { title = "Document", onPage } = {}) {
  const doc = await PdfDoc.open(bytes, password);
  const P = pdfium(), body = [], media = [];
  try {
    const form = doc.enableForms();
    for (let i = 0; i < doc.count; i++) {
      onPage?.(i + 1, doc.count);
      const pg = doc.page(i), [W, H] = doc.size(i);
      const page = readPage(P, pg, W, H);
      const { xml, areas } = pageXml(page, W, H);
      // lines and shading that became table borders are taken out of the picture; the others stay in it
      for (const s of page.shapes) {
        if (areas.some((a) => s.l >= a.l - 3 && s.r <= a.r + 3 && s.t >= a.t - 3 && s.b <= a.b + 3) && P.FPDFPage_RemoveObject(pg, s.o)) P.FPDFPageObj_Destroy(s.o);
      }
      const art = await leftovers(P, pg, W, H, form);
      const last = i === doc.count - 1;
      // first paragraph of the page holds the picture of what is not text or lines
      let pic = "";
      if (art) { media.push(art.png); pic = picture(media.length, `rIdImg${media.length}`, art.x, art.y, art.w, art.h); }
      body.push(spacer(1, pic));
      body.push(xml);
      body.push(last ? sect(W, H) : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect(W, H)}</w:pPr></w:p>`);
      doc.releasePages();
      await new Promise((r) => setTimeout(r));
    }
  } finally { doc.close(); }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const rels = media.map((_, k) => `<Relationship Id="rIdImg${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/picture${k + 1}.png"/>`).join("");
  const files = [
    { name: "[Content_Types].xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Flipleaf</dc:creator></cp:coreProperties>` },
    { name: "word/_rels/document.xml.rels", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels}</Relationships>` },
    { name: "word/settings.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>` },
    { name: "word/styles.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:lang w:val="el-GR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="28" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="28" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>` },
    { name: "word/document.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join("")}</w:body></w:document>` },
    ...media.map((png, k) => ({ name: `word/media/picture${k + 1}.png`, bytes: png })),
  ];
  return makeZip(files);
}
