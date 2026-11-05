// PDF → Word with the exact layout of the PDF.
// Every piece of text becomes an editable Word text frame placed where it is on the PDF page, with the
// same font, size, weight and colour. Everything that is not text (lines, boxes, shading, logos,
// photos) is drawn once per page as a picture behind the text, so the page looks the same as the PDF.

import { PdfDoc, pdfium, malloc, free, M, heap, readFloats } from "./pdfium.js";
import { makeZip } from "./zip.js";

const TEXT = 1, FORM = 5;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
const tw = (pt) => Math.round(pt * 20);      // twips
const emu = (pt) => Math.round(pt * 12700);  // English Metric Units

/** "ABCDEF+TimesNewRomanPS-BoldItalicMT" → { family: "Times New Roman", bold, italic } */
export function wordFont(base, weight, flags) {
  let n = (base || "").replace(/^[A-Z]{6}\+/, "");
  const style = n.match(/[-,_ ](.*)$/)?.[1] || "";
  const bold = /bold|black|heavy|semibold|demi/i.test(style) || /bold/i.test(n) || weight >= 600 || !!(flags & 262144);
  const italic = /italic|oblique/i.test(n) || !!(flags & 64);
  n = n.replace(/[-,_].*$/, "").replace(/(PSMT|PS|MT|Std|Pro|LT)$/g, "");
  const known = { helvetica: "Arial", arial: "Arial", arialmt: "Arial", times: "Times New Roman", timesroman: "Times New Roman", timesnewroman: "Times New Roman",
    courier: "Courier New", couriernew: "Courier New", symbol: "Symbol", zapfdingbats: "Wingdings", calibri: "Calibri", cambria: "Cambria",
    verdana: "Verdana", tahoma: "Tahoma", georgia: "Georgia", segoeui: "Segoe UI", garamond: "Garamond", centurygothic: "Century Gothic" };
  const key = n.toLowerCase().replace(/[^a-z]/g, "");
  const family = known[key] || n.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Arial";
  return { family, bold, italic };
}

/** Measures text with the same font, to fine-tune letter spacing so lines end where they end in the PDF. */
const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
function measure(text, f, size) {
  if (!measureCtx) return 0;
  measureCtx.font = `${f.italic ? "italic " : ""}${f.bold ? "700 " : "400 "}${size}px "${f.family}", Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

function readText(P, fn) {
  const len = fn(0, 0);
  if (len <= 2) return "";
  const p = malloc(len);
  try { fn(p, len); return M().UTF16ToString(p); } finally { free(p); }
}
function readAscii(P, fn) {
  const len = fn(0, 0);
  if (len <= 1) return "";
  const p = malloc(len);
  try { fn(p, len); return M().UTF8ToString(p); } finally { free(p); }
}

/** Page point → display point (top-left origin, rotation applied), in PDF points. */
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

/** Reads the text of one page and removes it from the page, leaving only graphics behind. */
function takeText(P, pg, W, H) {
  const toView = mapper(P, pg, W, H), tp = P.FPDFText_LoadPage(pg);
  const runs = [], taken = [];
  const n = P.FPDFPage_CountObjects(pg);
  for (let k = 0; k < n; k++) {
    const o = P.FPDFPage_GetObject(pg, k);
    if (P.FPDFPageObj_GetType(o) !== TEXT) continue;
    if (P.FPDFTextObj_GetTextRenderMode(o) === 3) continue; // invisible text (scanned pages): the picture already shows it
    const m = readFloats(6, (p) => P.FPDFPageObj_GetMatrix(o, p));
    const fs = readFloats(1, (p) => P.FPDFTextObj_GetFontSize(o, p));
    if (!m || !fs) continue;
    const [x0, y0] = toView(m[4], m[5]), [x1, y1] = toView(m[4] + m[0], m[5] + m[1]);
    const dx = x1 - x0, dy = y1 - y0;
    if (dx <= 0 || Math.abs(dy) > Math.abs(dx) * 0.05) continue; // rotated or vertical text stays in the picture
    const size = fs[0] * Math.hypot(m[2], m[3]);
    if (!(size > 1 && size < 400)) continue;
    const raw = readText(P, (p, l) => P.FPDFTextObj_GetText(o, tp, p, l)).replace(/\r?\n/g, " ");
    const font = P.FPDFTextObj_GetFont(o);
    const f = wordFont(readAscii(P, (p, l) => P.FPDFFont_GetBaseFontName(font, p, l)), P.FPDFFont_GetWeight(font), P.FPDFFont_GetFlags(font));
    const text = raw.trim();
    if (!text) { taken.push(o); continue; } // spaces only
    // Width of what is visible. Many PDFs (SAP and other forms) pad text with spaces, so the PDF's own
    // box is often much wider than the words; measuring the words keeps the columns apart.
    const lead = measure(raw.match(/^\s*/)[0], f, size), width = measure(text, f, size);
    let x = x0 + lead, right = x + width;
    if (!width) {
      const b = readFloats(4, (p) => P.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12));
      right = x0;
      if (b) { const [bx0] = toView(b[0], b[1]), [bx1] = toView(b[2], b[3]); right = Math.max(bx0, bx1); }
      x = x0;
    }
    const c = malloc(16);
    let color = "000000";
    if (P.FPDFPageObj_GetFillColor(o, c, c + 4, c + 8, c + 12)) color = [0, 4, 8].map((i) => M().getValue(c + i, "i32").toString(16).padStart(2, "0")).join("");
    free(c);
    runs.push({ text, x, y: y0, right: Math.max(right, x), size, ...f, color });
    taken.push(o);
  }
  P.FPDFText_ClosePage(tp);
  for (const o of taken) if (P.FPDFPage_RemoveObject(pg, o)) P.FPDFPageObj_Destroy(o);
  return runs;
}

/** Joins the pieces of text that belong together (same line, close to each other) into one frame each. */
function lines(runs) {
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const r of runs) {
    const row = rows.find((w) => Math.abs(w.y - r.y) < Math.min(w.size, r.size) * 0.3);
    if (row) row.runs.push(r); else rows.push({ y: r.y, size: r.size, runs: [r] });
  }
  const segs = [];
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const r of row.runs) {
      const gap = seg ? r.x - seg.right : Infinity;
      if (seg && gap < Math.max(seg.size, r.size) * 1.6 && gap > -Math.max(seg.size, r.size)) {
        const prev = seg.runs[seg.runs.length - 1];
        if (gap > r.size * 0.12) prev.text += " ";
        seg.runs.push(r); seg.right = Math.max(seg.right, r.right); seg.size = Math.max(seg.size, r.size); seg.y = Math.max(seg.y, r.y);
      } else {
        seg = { x: r.x, y: r.y, right: r.right, size: r.size, runs: [r] };
        segs.push(seg);
      }
    }
  }
  // collapse runs of spaces PDFs use for alignment (Word would make the line longer)
  for (const s of segs) for (const r of s.runs) r.text = r.text.replace(/\s{2,}/g, " ");
  return segs;
}

/** Draws what is left on the page (lines, boxes, pictures) into a PNG. Returns null for an empty page. */
async function background(P, pg, W, H, scale, form) {
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const bmp = P.FPDFBitmap_Create(w, h, 0);
  try {
    P.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
    P.FPDF_RenderPageBitmap(bmp, pg, 0, 0, w, h, 0, 0x01 | 0x800); // annotations, print quality
    if (form) P.FPDF_FFLDraw(form, bmp, pg, 0, 0, w, h, 0, 0x01 | 0x800); // form fields
    const buf = P.FPDFBitmap_GetBuffer(bmp), stride = P.FPDFBitmap_GetStride(bmp), src = heap();
    const img = new ImageData(w, h), d = img.data;
    let blank = true;
    for (let y = 0; y < h; y++) {
      let s = buf + y * stride, o = y * w * 4;
      for (let x = 0; x < w; x++, s += 4, o += 4) {
        d[o] = src[s + 2]; d[o + 1] = src[s + 1]; d[o + 2] = src[s]; d[o + 3] = 255;
        if (blank && (src[s] < 250 || src[s + 1] < 250 || src[s + 2] < 250)) blank = false;
      }
    }
    if (blank) return null;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").putImageData(img, 0, 0);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { P.FPDFBitmap_Destroy(bmp); }
}

function frame(seg, W) {
  const size = seg.size, line = Math.max(1, size * 1.17);
  // Word puts the baseline of an exact-height line about 80 % down the line
  const top = seg.y - line * 0.8;
  const pdfWidth = seg.right - seg.x;
  const wordWidth = seg.runs.reduce((a, r) => a + measure(r.text, r, r.size), 0);
  const width = Math.min(Math.max(W - seg.x - 1, 20), Math.max(pdfWidth, wordWidth) * 1.12 + size * 1.5 + 4);
  const runs = seg.runs.map((r) => {
    const fonts = `<w:rFonts w:ascii="${esc(r.family)}" w:hAnsi="${esc(r.family)}" w:cs="${esc(r.family)}" w:eastAsia="${esc(r.family)}"/>`;
    const rPr = `<w:rPr>${fonts}${r.bold ? "<w:b/><w:bCs/>" : ""}${r.italic ? "<w:i/><w:iCs/>" : ""}${r.color !== "000000" ? `<w:color w:val="${r.color}"/>` : ""}<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/></w:rPr>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
  }).join("");
  const fp = `<w:framePr w:w="${tw(width)}" w:hSpace="0" w:wrap="around" w:vAnchor="page" w:hAnchor="page" w:x="${tw(Math.max(0, seg.x))}" w:y="${tw(Math.max(0, top))}"/>`;
  return `<w:p><w:pPr>${fp}<w:spacing w:before="0" w:after="0" w:line="${tw(line)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>${runs}</w:p>`;
}

function picture(id, rid, W, H) {
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${emu(W)}" cy="${emu(H)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Page ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="page${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(W)}" cy="${emu(H)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

const sect = (W, H) => `<w:sectPr><w:pgSz w:w="${tw(W)}" w:h="${tw(H)}"${W > H ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

/** PDF bytes → .docx bytes with the PDF's exact layout. */
export async function exactDocx(bytes, password, { title = "Document", onPage } = {}) {
  const doc = await PdfDoc.open(bytes, password);
  const P = pdfium(), body = [], media = [];
  try {
    const form = doc.enableForms();
    for (let i = 0; i < doc.count; i++) {
      onPage?.(i + 1, doc.count);
      const pg = doc.page(i), [W, H] = doc.size(i);
      const segs = lines(takeText(P, pg, W, H));
      const png = await background(P, pg, W, H, 2.5, form);
      for (const s of segs) body.push(frame(s, W));
      let holder = "";
      if (png) { media.push(png); holder = picture(media.length, `rIdImg${media.length}`, W, H); }
      const last = i === doc.count - 1;
      body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${last ? "" : sect(W, H)}</w:pPr>${holder}</w:p>`);
      if (last) body.push(sect(W, H));
      doc.releasePages();
      await new Promise((r) => setTimeout(r)); // keep the window responsive
    }
  } finally { doc.close(); }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const rels = media.map((_, k) => `<Relationship Id="rIdImg${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${k + 1}.png"/>`).join("");
  const files = [
    { name: "[Content_Types].xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>Flipleaf</dc:creator></cp:coreProperties>` },
    { name: "word/_rels/document.xml.rels", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels}</Relationships>` },
    { name: "word/settings.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>` },
    { name: "word/styles.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:lang w:val="el-GR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>` },
    { name: "word/document.xml", bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join("")}</w:body></w:document>` },
    ...media.map((png, k) => ({ name: `word/media/page${k + 1}.png`, bytes: png })),
  ];
  return makeZip(files);
}
