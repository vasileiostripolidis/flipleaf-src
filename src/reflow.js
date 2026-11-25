// Closing the gap left by deleted content. PDF pages have no text flow, so the flow is rebuilt from
// the page geometry: objects are grouped into rows, running headers/footers are left alone, rows below
// the gap move up, and whole rows from the following pages move up to fill the room that frees up.
//
// Pure layout logic: works on plain boxes, returns a plan the editor applies with PDFium.
//   pages: [{ height, width, objs: [{ id, l, b, r, t, kind: "text"|"image"|"path", text, blank, size }] }]
//   gap:   { page, boxes: [{ l, b, r, t }] }   (the deleted objects, in PDF points)
// Returns { ok, moves: Map(id → { page, dy }), drop: [ids], removePages: [indexes] }.

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
const sigOf = (s) => strip(s).replace(/\d+/g, "#").replace(/\s+/g, "");
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2), n = grams.get(g); if (n) { hit++; grams.set(g, n - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}
const median = (xs, fallback) => { if (!xs.length) return fallback; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const hasText = (row) => row.items.some((o) => o.kind === "text" && !o.blank);

/** Groups objects into rows: objects that share most of their height belong to the same row. */
/** Clusters objects into rows by vertical overlap (top to bottom). */
function cluster(list) {
  const rows = [];
  for (const o of [...list].sort((a, b) => b.t - a.t || a.l - b.l)) {
    const h = Math.max(o.t - o.b, 0.5);
    let row = null;
    for (let j = rows.length - 1; j >= 0 && j >= rows.length - 3; j--) {
      const r = rows[j], ov = Math.min(o.t, r.t) - Math.max(o.b, r.b);
      if (ov > 0.4 * Math.min(h, Math.max(r.t - r.b, 0.5))) { row = r; break; }
    }
    if (row) { row.items.push(o); row.t = Math.max(row.t, o.t); row.b = Math.min(row.b, o.b); }
    else rows.push({ t: o.t, b: o.b, items: [o] });
  }
  return rows;
}
const nearestRow = (rows, o) => {
  const c = (o.t + o.b) / 2;
  let best = rows[0], d = Infinity;
  for (const r of rows) { const dd = c > r.t ? c - r.t : c < r.b ? r.b - c : 0; if (dd < d) { d = dd; best = r; } }
  return best;
};

export function rowsOf(objs) {
  const solid = objs.filter((o) => !o.blank);
  // small marks (accents, music signs, superscripts) placed between lines would otherwise chain the lines
  // above and below them into one: they are grouped separately and join the nearest line afterwards
  const hs = solid.filter((o) => o.kind === "text").map((o) => o.t - o.b).sort((a, b) => a - b);
  const typical = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  const small = (o) => o.kind === "text" && typical > 0 && o.t - o.b < typical * 0.55;
  const rows = cluster(solid.filter((o) => !small(o)));
  const minor = cluster(solid.filter(small));
  const width = Math.max(1, ...solid.map((o) => o.r)) - Math.min(...solid.map((o) => o.l), 0);
  const loose = [];
  for (const m of minor) {
    const w = Math.max(...m.items.map((o) => o.r)) - Math.min(...m.items.map((o) => o.l));
    if (m.items.length >= 3 && w > width * 0.25) rows.push(m); // a line of small text of its own
    else loose.push(...m.items);
  }
  rows.sort((a, b) => b.t - a.t);
  // rows that grew into each other become one
  for (let j = rows.length - 1; j > 0; j--) {
    const a = rows[j - 1], c = rows[j], ov = Math.min(a.t, c.t) - Math.max(a.b, c.b);
    if (ov > 0.4 * Math.min(a.t - a.b, c.t - c.b)) { a.items.push(...c.items); a.t = Math.max(a.t, c.t); a.b = Math.min(a.b, c.b); rows.splice(j, 1); }
  }
  rows.sort((a, b) => b.t - a.t);
  // thin rules and other decorations without text stay with the row they belong to
  for (let j = rows.length - 1; j >= 0; j--) {
    const r = rows[j];
    if (hasText(r) || r.t - r.b > 6 || rows.length < 2) continue;
    const above = rows[j - 1], below = rows[j + 1];
    const da = above ? above.b - r.t : Infinity, db = below ? r.b - below.t : Infinity;
    const into = da <= db ? above : below;
    if (!into || Math.min(da, db) > 14) continue;
    into.items.push(...r.items); into.t = Math.max(into.t, r.t); into.b = Math.min(into.b, r.b);
    rows.splice(j, 1);
  }
  // small marks join the nearest line (and widen it); spaces and invisible text go with it without widening
  if (!rows.length && loose.length) rows.push(...cluster(loose).map((r) => r)), loose.length = 0;
  for (const o of loose) { const r = nearestRow(rows, o); r.items.push(o); r.t = Math.max(r.t, o.t); r.b = Math.min(r.b, o.b); }
  for (const o of objs) if (o.blank && rows.length) nearestRow(rows, o).items.push(o);
  for (const r of rows) {
    r.l = Math.min(...r.items.map((o) => o.l)); r.r = Math.max(...r.items.map((o) => o.r));
    r.sig = sigOf(r.items.filter((o) => o.kind === "text").sort((a, b) => a.l - b.l).map((o) => o.text || "").join(""));
  }
  return rows;
}

/** Rows, running headers/footers and the usual spacing of the document. */
function analyze(pages, phantomPage = -1, phantomBoxes = []) {
  const n = pages.length;
  // objects that cover most of the page (backgrounds, frames) never move
  const fixed = (p, o) => o.kind !== "text" && (o.r - o.l) * (o.t - o.b) > 0.5 * p.width * p.height;
  const phantom = phantomBoxes.map((b, j) => ({ id: "deleted:" + j, kind: "text", text: "x", blank: false, deleted: true, ...b }));
  const rows = pages.map((p, i) => rowsOf([...p.objs.filter((o) => !fixed(p, o)), ...(i === phantomPage ? phantom : [])]));

  // usual spacing between rows, from all pages
  const gaps = [];
  for (const rs of rows) for (let j = 1; j < rs.length; j++) { const d = rs[j - 1].b - rs[j].t; if (d > -1) gaps.push(d); }
  const lineGap = Math.max(1, median(gaps, 4));

  // running headers and footers: rows at the top or bottom edge, well apart from the text, that repeat on other pages
  const furniture = rows.map(() => new Set());
  for (let i = 0; i < n; i++) {
    const rs = rows[i], H = pages[i].height;
    const others = [];
    for (let d = 1; others.length < 8 && (i - d >= 0 || i + d < n); d++) { if (i + d < n) others.push(i + d); if (i - d >= 0) others.push(i - d); }
    const repeats = (r) => {
      const numberOnly = r.sig && /^[#\-–—.·|/()\[\]σελιδαpage]*$/.test(r.sig) && r.sig.includes("#");
      if (numberOnly) return true;
      // the same place, the same width or alignment, (nearly) the same text — on at least two other pages
      const same = (x) => Math.abs(x.t - r.t) < 3 && Math.abs(x.b - r.b) < 3 &&
        (Math.abs(x.l - r.l) < 6 || Math.abs(x.r - r.r) < 6 || Math.abs((x.l + x.r) - (r.l + r.r)) < 12) &&
        (r.sig || x.sig ? dice(r.sig, x.sig) >= 0.8 : Math.abs(x.l - r.l) < 3 && Math.abs(x.r - r.r) < 3);
      const hits = others.filter((q) => rows[q].some(same)).length;
      return hits >= Math.min(2, others.length);
    };
    const apart = (a, b) => !b || a.b - b.t > Math.max(1.8 * lineGap, 6) || b.b - a.t > Math.max(1.8 * lineGap, 6);
    for (let j = 0; j < rs.length; j++) {
      const r = rs[j];
      if (r.b < H * 0.8 || r.items.some((o) => o.deleted) || !apart(r, rs[j + 1]) || !repeats(r)) break;
      furniture[i].add(r);
    }
    for (let j = rs.length - 1; j >= 0; j--) {
      const r = rs[j];
      if (r.t > H * 0.2 || furniture[i].has(r) || r.items.some((o) => o.deleted) || !apart(r, rs[j - 1]) || !repeats(r)) break;
      furniture[i].add(r);
    }
  }
  const body = rows.map((rs, i) => rs.filter((r) => !furniture[i].has(r)));

  // paragraph spacing, text width, the top of the text on each page and the lowest line on full pages
  const bodyGaps = [];
  for (const rs of body) for (let j = 1; j < rs.length; j++) bodyGaps.push(rs[j - 1].b - rs[j].t);
  const lineSp = Math.max(0.5, median(bodyGaps.filter((d) => d > -1), lineGap));
  const paraSp = median(bodyGaps.filter((d) => d > lineSp * 1.4 + 1.5), lineSp);
  const rowH = median(body.flat().filter(hasText).map((r) => r.t - r.b), 10);
  const rightEdge = Math.max(...body.flat().map((r) => r.r), 0);
  const leftEdge = Math.min(...body.flat().map((r) => r.l), rightEdge);
  const tops = body.map((rs) => (rs.length ? rs[0].t : null));
  const real = (r) => r.items.some((o) => !o.deleted);
  // (lines of text only: frames and pictures on cover pages and the like do not set the margin)
  const lows = body.map((rs) => rs.filter((r) => real(r) && hasText(r))).map((rs) => (rs.length ? rs[rs.length - 1].b : null)).slice(0, -1).filter((v) => v !== null);
  const fallbackBottom = Math.min(...body.flat().filter((r) => real(r) && hasText(r)).map((r) => r.b), Infinity);
  let bottom = lows.length ? Math.min(...lows) : fallbackBottom;
  // never down into a footer
  for (let i = 0; i < n; i++) for (const r of furniture[i]) if (r.t < pages[i].height / 2) bottom = Math.max(bottom, r.t + paraSp);

  // headings: rows with text clearly bigger than the body text
  const sizes = body.flat().flatMap((r) => r.items.filter((o) => o.kind === "text" && !o.blank && o.size > 0).map((o) => o.size));
  const textSize = median(sizes, 0);
  const big = (r) => hasText(r) && (textSize ? Math.max(...r.items.map((o) => o.size || 0)) > textSize * 1.25 : r.t - r.b > rowH * 1.5);
  // headings are the exception; when big rows are common (music: the signs are bigger than the words) they are just text
  const textRows = body.flat().filter(hasText);
  const headingsAreRare = textRows.filter(big).length <= Math.max(2, textRows.length * 0.15);
  const isHeading = (r) => headingsAreRare && big(r);
  /** Width of the first word of a row (to tell whether it would have fitted on the line before). */
  const firstWord = (r) => {
    const items = r.items.filter((o) => o.kind === "text" && !o.blank).sort((x, y) => x.l - y.l);
    if (!items.length) return 0;
    const f = items[0], txt = (f.text || "").replace(/^\s+/, ""), sp = txt.search(/\s/);
    if (sp > 0) return ((f.r - f.l) * sp) / txt.length;
    let end = f.r;
    for (let j = 1; j < items.length; j++) {
      const o = items[j];
      if (o.l - end > Math.max(1, (r.t - r.b) * 0.22) || /^\s/.test(o.text || "")) break;
      end = o.r;
      const s2 = (o.text || "").search(/\s/);
      if (s2 > 0) { end = o.l + ((o.r - o.l) * s2) / o.text.length; break; }
    }
    return end - f.l;
  };
  // a paragraph ended on row a if b starts indented, or if b's first word would have fitted on a
  const newParagraph = (a, b) => b.l > leftEdge + 8 || a.r + firstWord(b) + 4 < rightEdge;
  /** The spacing two rows should have when they follow each other. */
  const spacing = (a, b) => (isHeading(a) || isHeading(b) || (hasText(a) && hasText(b) && newParagraph(a, b)) ? paraSp : lineSp);
  // lines that belong together (music: the signs and the words under them, set close to each other while
  // the pairs are set apart) — only when the spacing clearly comes in two kinds
  const sorted = bodyGaps.filter((d) => d > -50).sort((a, b) => a - b);
  const p75 = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 0, tight = p75 * 0.3;
  const share = sorted.length ? sorted.filter((d) => d < tight).length / sorted.length : 0;
  const pairs = p75 > 8 && share > 0.25 && share < 0.75;
  const bound = (a, b) => pairs && a.b - b.t < tight;
  return { bound, n, rows, furniture, body, tops, bottom, lineSp, paraSp, rowH, isHeading, spacing };
}

/**
 * Empty space on page i worth closing: between two rows, or at the bottom of a page that the next
 * page could fill. Returns [{ at, top, bottom }] (PDF points; "at" is a height inside the space).
 */
export function findGaps(pages, i) {
  if (i < 0 || i >= pages.length) return [];
  const { n, body, bottom, rowH, paraSp, spacing, isHeading } = analyze(pages);
  const own = body[i], out = [];
  const min = Math.max(2.2 * rowH, 26);
  for (let j = 1; j < own.length; j++) {
    const a = own[j - 1], b = own[j], extra = a.b - b.t - spacing(a, b);
    if (extra > min) out.push({ at: (a.b + b.t) / 2, top: a.b, bottom: b.t });
  }
  const last = own[own.length - 1], next = body[i + 1]?.[0];
  if (last && next && i + 1 < n) {
    // a heading only moves together with what follows it
    const src = body[i + 1];
    let k = 0;
    while (k < 3 && k + 1 < src.length && isHeading(src[k])) k++;
    const free = last.b - bottom, need = next.t - src[k].b + paraSp;
    if (free > Math.max(min, need + 2)) out.push({ at: (last.b + bottom) / 2, top: last.b, bottom });
  }
  return out;
}

/**
 * gap: { page, boxes } — rows deleted just now (their boxes) close up; or
 *      { page, at }    — the empty space around height "at" closes up.
 */
export function planGap(pages, gap) {
  const n = pages.length;
  const fail = { ok: false, moves: new Map(), drop: [], removePages: [] };
  if (!gap || gap.page < 0 || gap.page >= n || (!gap.boxes?.length && typeof gap.at !== "number")) return fail;
  const { body, tops, bottom, isHeading, spacing, bound, rowH, paraSp } = analyze(pages);

  const moves = new Map(), drop = [];
  const shiftRow = (r, page, dy) => {
    r.t += dy; r.b += dy;
    for (const o of r.items) {
      if (o.deleted) continue;
      const m = moves.get(o.id) || { page, dy: 0 };
      m.page = page; m.dy += dy;
      moves.set(o.id, m);
    }
  };

  // 1. the page itself. The empty space is found from what is left on the page: the lowest thing above
  // the deleted part (or the pointed-at height) and the highest thing below it. Everything below moves up
  // until the two have their usual distance. (Text in one column of several: only that column moves.)
  const own = body[gap.page];
  // text from the next page only comes up if this page was full (a page that ended early, like the end of
  // a chapter, stays that way) — or when the empty space pointed at is the bottom of the page
  const lastB = own.length ? own[own.length - 1].b : null;
  const lowest = gap.boxes ? Math.min(lastB ?? Infinity, ...gap.boxes.map((q) => q.b)) : lastB;
  const wasFull = lowest !== null && lowest - bottom < rowH * 2.5 + paraSp;
  const atBottom = !gap.boxes && (lastB === null || gap.at < lastB);
  const box = gap.boxes
    ? { l: Math.min(...gap.boxes.map((q) => q.l)), b: Math.min(...gap.boxes.map((q) => q.b)), r: Math.max(...gap.boxes.map((q) => q.r)), t: Math.max(...gap.boxes.map((q) => q.t)) }
    : { l: -Infinity, r: Infinity, b: gap.at, t: gap.at };
  const mid = (box.b + box.t) / 2;
  const textL = Math.min(...own.map((r) => r.l), box.l), textR = Math.max(...own.map((r) => r.r), box.r);
  const full = !gap.boxes || box.r - box.l > 0.5 * (textR - textL);
  const centre = (x) => (x.t + x.b) / 2;
  let prevB = null, nextT = null, prevRow = null, nextRow = null, lower = [];
  if (full) {
    const up = own.filter((r) => centre(r) > mid), down = own.filter((r) => centre(r) <= mid);
    prevRow = up[up.length - 1] || null; nextRow = down[0] || null;
    prevB = prevRow?.b ?? null; nextT = nextRow?.t ?? null;
    lower = down;
  } else {
    const items = own.flatMap((r) => r.items.map((o) => ({ o, r }))).filter(({ o }) => !o.deleted && o.r > box.l - 2 && o.l < box.r + 2);
    const up = items.filter(({ o }) => centre(o) > mid), down = items.filter(({ o }) => centre(o) <= mid);
    for (const { o, r } of up) if (prevB === null || o.b < prevB) { prevB = o.b; prevRow = r; }
    for (const { o, r } of down) if (nextT === null || o.t > nextT) { nextT = o.t; nextRow = r; }
    lower = down;
  }
  if (nextRow) {
    let want;
    if (typeof gap.space === "number") want = Math.max(0, gap.space);
    else if (gap.boxes) {
      // the spacing there was next to what was deleted (above it or below it) is kept
      const around = [prevRow ? prevB - box.t : -1, box.b - nextT].filter((d) => d >= 0);
      want = around.length ? Math.max(...around) : prevRow ? spacing(prevRow, nextRow) : 0;
      if (prevRow) want = Math.min(want, Math.max(spacing(prevRow, nextRow) * 2, 4));
    } else if (gap.band && prevRow) {
      // the user marked this empty space: what was marked goes (even if the spacing was the usual one)
      const free = prevB - nextT, cut = Math.max(0, Math.min(prevB, gap.top) - Math.max(nextT, gap.bottom));
      want = Math.max(0.5, free - Math.max(cut, Math.min(free, 2)));
      if (want > spacing(prevRow, nextRow)) want = Math.min(want, spacing(prevRow, nextRow));
    } else want = prevRow ? spacing(prevRow, nextRow) : 0;
    const target = prevRow ? prevB - want : gap.boxes ? box.t : tops[gap.page] ?? nextT;
    const dy = target - nextT;
    if (dy > 0.3) {
      if (full) for (const r of lower) shiftRow(r, gap.page, dy);
      else for (const { o } of lower) { const m = moves.get(o.id) || { page: gap.page, dy: 0 }; m.dy += dy; moves.set(o.id, m); o.t += dy; o.b += dy; }
    }
  }
  if (!full) return moves.size ? { ok: true, moves, drop, removePages: [] } : fail;

  // 2. whole rows from the next pages move up, page after page
  let cur = gap.page;
  for (let nxt = cur + 1; (wasFull || atBottom) && nxt < n; nxt++) {
    const src = body[nxt], dst = body[cur];
    if (!src.length) break;
    const last = dst[dst.length - 1];
    const first = src[0];
    const space = last ? spacing(last, first) : 0;
    const target = last ? last.b - space : tops[cur] ?? first.t;
    const dy = target - first.t;
    let take = 0;
    while (take < src.length && src[take].b + dy >= bottom - 0.5) take++;
    // a heading is not left alone at the bottom of a page
    // (nor a heading with its subtitle)
    for (let guard = 0; guard < 4 && take > 0 && take < src.length; guard++) {
      const h = [take - 1, take - 2].find((x) => x >= 0 && isHeading(src[x]));
      if (h === undefined) break;
      take = h;
    }
    while (take > 0 && take < src.length && bound(src[take - 1], src[take])) take--; // keep pairs together
    if (!take) break;
    for (const r of src.slice(0, take)) shiftRow(r, cur, dy);
    dst.push(...src.splice(0, take));
    if (src.length) {
      const up = (tops[nxt] ?? src[0].t) - src[0].t;
      if (up > 0.01) for (const r of src) shiftRow(r, nxt, up);
      cur = nxt;
    } else {
      // the page emptied: the rows of the page after it go to its top
      cur = nxt;
    }
  }

  // pages at the end that are left with nothing but their header/footer
  const removePages = [];
  for (let i = n - 1; i > gap.page && !body[i].length; i--) removePages.push(i);
  if (!moves.size && !drop.length) return fail;
  return { ok: true, moves, drop, removePages };
}

/** Where new space can be opened on page i: the boundaries between rows (PDF heights), and one line's height. */
export function insertPoints(pages, i) {
  const { body, lineSp, rowH, bound } = analyze(pages);
  // spots: { at, space } — space is the room there is now between the two rows
  const own = body[i] || [], spots = [];
  if (own.length) {
    spots.push({ at: own[0].t + Math.min(lineSp, 4), space: 0, first: true });
    for (let j = 1; j < own.length; j++) spots.push({ at: (own[j - 1].b + own[j].t) / 2, space: Math.max(0, own[j - 1].b - own[j].t), inner: bound(own[j - 1], own[j]) });
  }
  return { spots, line: rowH + lineSp };
}

/**
 * Opens up empty space: everything below height "at" on page "page" moves down by "height" points;
 * whatever no longer fits moves on to the next pages (new pages are added at the end if needed).
 * Returns { ok, moves, newPages: [{ width, height }] } — moves may point at the new pages (n, n+1…).
 */
export function planInsert(pages, { page, at, height, pageBreak = false }) {
  const fail = { ok: false, moves: new Map(), newPages: [] };
  if (page < 0 || page >= pages.length) return fail;
  const { n, body, tops, bottom, isHeading, spacing, bound } = analyze(pages);
  if (pageBreak) {
    // page break: just enough space that everything after the point goes to the next page
    const own = body[page], j = own.findIndex((r) => (r.t + r.b) / 2 < at);
    if (j <= 0) return fail;
    height = own[j].b - bottom + 1;
  }
  if (!(height > 0)) return fail;
  const moves = new Map(), newPages = [];
  const shiftRow = (r, pg, dy) => {
    r.t += dy; r.b += dy;
    for (const o of r.items) {
      const m = moves.get(o.id) || { page: pg, dy: 0 };
      m.page = pg; m.dy += dy;
      moves.set(o.id, m);
    }
  };
  const top0 = tops[page] ?? tops.find((v) => v !== null) ?? pages[page].height - 72;
  let carry = [];
  for (let p = page; ; p++) {
    if (p >= n + newPages.length) {
      if (!carry.length) break;
      newPages.push({ width: pages[n - 1].width, height: pages[n - 1].height });
      body[p] = [];
    }
    let rows = body[p];
    if (p === page) {
      const j = rows.findIndex((r) => (r.t + r.b) / 2 < at);
      if (j === -1) return fail; // nothing below the point
      for (const r of rows.slice(j)) shiftRow(r, p, -height);
    } else if (carry.length) {
      // the rows pushed off the page before go to the top of this one, the rest goes down after them
      const start = tops[p] ?? top0, off = start - carry[0].t;
      for (const r of carry) shiftRow(r, p, off);
      if (rows.length) {
        const target = carry[carry.length - 1].b - spacing(carry[carry.length - 1], rows[0]);
        const dy = target - rows[0].t;
        if (dy < 0) for (const r of rows) shiftRow(r, p, dy);
      }
      rows = body[p] = [...carry, ...rows];
    } else break;
    // what no longer fits goes on to the next page (a heading goes with what follows it)
    let k = rows.findIndex((r) => r.b < bottom - 0.5);
    if (k === -1) { carry = []; break; }
    while (k > 0 && bound(rows[k - 1], rows[k])) k--; // keep pairs together
    for (let guard = 0; guard < 4 && k > 0; guard++) {
      const h = [k - 1, k - 2].find((x) => x >= 0 && isHeading(rows[x]));
      if (h === undefined) break;
      k = h;
    }
    if (k === 0 && p !== page) k = 1; // a block taller than a page: keep at least one row, or this never ends
    carry = rows.slice(k);
    body[p] = rows.slice(0, k);
    if (!carry.length) break;
    if (newPages.length > 50) return fail;
  }
  return { ok: moves.size > 0, moves, newPages };
}
