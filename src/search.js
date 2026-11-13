// Find in document.
// The text of every page is read once (in the background) into a searchable index, so each search
// is a plain scan in memory: instant, even for long documents. Matching ignores case, accents and
// final sigma by default, works across line breaks and hyphenated words, and treats look-alike
// punctuation (quotes, dashes) the same. Results are listed with their context and highlighted
// exactly on the page.

const WORD = /[\p{L}\p{N}]/u;

/* ------------------------------------------------------------------ normalising text */

const foldCache = [new Map(), new Map(), new Map(), new Map()];
/** One character → its searchable form (can be "" or several characters). */
function fold(ch, keepCase, keepAccents) {
  const cache = foldCache[(keepCase ? 1 : 0) + (keepAccents ? 2 : 0)];
  let v = cache.get(ch);
  if (v !== undefined) return v;
  v = ch.normalize("NFKC"); // ligatures (ﬁ), full-width forms, superscripts
  if (/\s/.test(v) || v === " ") v = " ";
  else {
    v = v.replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„‟″«»]/g, '"').replace(/[‐‑‒–—―−]/g, "-").replace(/[­​-‍﻿]/g, "");
    if (!keepAccents) v = v.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
    if (!keepCase) v = v.toLowerCase().replace(/ς/g, "σ");
  }
  cache.set(ch, v);
  return v;
}

/** Text → searchable string plus, for every character of it, the index of the source character. */
function normalise(text, keepCase, keepAccents) {
  let out = "";
  const map = [];
  let space = true; // collapse runs of spaces (and drop leading ones)
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i), ch = String.fromCodePoint(cp);
    const f = fold(ch, keepCase, keepAccents);
    for (const c of f) {
      if (c === " ") { if (space) continue; space = true; } else space = false;
      out += c; map.push(i);
    }
    if (cp > 0xffff) i++;
  }
  if (out.endsWith(" ")) { out = out.slice(0, -1); map.pop(); }
  return { text: out, map };
}

/* ------------------------------------------------------------------ the index */

/**
 * One page's text as a single string. Pieces of text are joined with a space when there is a gap
 * between them or a new line starts; a word broken with a hyphen at the end of a line is joined.
 * `piece[i]`/`offset[i]` tell where every character is on the page, so matches can be drawn there.
 */
function pageText(items) {
  let text = "";
  const piece = [], offset = [];
  let prev = null, k = -1;
  items.forEach((it) => {
    if (it.str === undefined) return;
    if (it.str) k++; // the page shows one element per non-empty piece of text
    const s = it.str, tf = it.transform || [1, 0, 0, 1, 0, 0], size = Math.hypot(tf[2], tf[3]) || Math.abs(tf[0]) || 10;
    if (prev && s) {
      const sameLine = Math.abs(tf[5] - prev.y) < size * 0.5;
      const gap = tf[4] - prev.end;
      if (!sameLine || prev.eol) {
        if (/[\p{L}]-$/u.test(text) && /^[\p{Ll}]/u.test(s)) { text = text.slice(0, -1); piece.pop(); offset.pop(); } // hyphenated word
        else if (!/\s$/.test(text) && !/^\s/.test(s)) { text += " "; piece.push(-1); offset.push(0); }
      } else if (gap > size * 0.18 && !/\s$/.test(text) && !/^\s/.test(s)) { text += " "; piece.push(-1); offset.push(0); }
    }
    for (let i = 0; i < s.length; i++) { text += s[i]; piece.push(k); offset.push(i); }
    if (s) prev = { y: tf[5], end: tf[4] + (it.width || 0), eol: !!it.hasEOL };
    else if (it.hasEOL && prev) prev.eol = true;
  });
  return { text, piece: Int32Array.from(piece), offset: Int32Array.from(offset) };
}

export function createSearch({ viewer, container, t, onUpdate }) {
  let pdf = null, pages = [], building = null, ready = 0;
  let query = "", opts = { matchCase: false, wholeWords: false, matchAccents: false, highlightAll: true };
  let hits = [], current = -1, pagesWithHits = 0;
  const normCache = new Map(); // `${page}|${case}${accents}` → normalised text

  function reset(newPdf = null) {
    pdf = newPdf; pages = []; ready = 0; building = null; normCache.clear();
    hits = []; current = -1; clearPaint();
  }

  /** Reads the text of all pages, a few at a time, without blocking the window. */
  function build() {
    if (!pdf || building) return building;
    const doc = pdf, total = doc.numPages;
    building = (async () => {
      for (let i = 0; i < total; i++) {
        if (doc !== pdf) return;
        try {
          const page = await doc.getPage(i + 1);
          const tc = await page.getTextContent({ disableNormalization: true });
          pages[i] = pageText(tc.items);
        } catch { pages[i] = { text: "", piece: new Int32Array(0), offset: new Int32Array(0) }; }
        ready = i + 1;
        if (query && (i % 8 === 7 || i === total - 1)) run(false);
      }
      if (doc === pdf) onUpdate?.();
    })();
    return building;
  }

  function normPage(i) {
    const key = `${i}|${+opts.matchCase}${+opts.matchAccents}`;
    let n = normCache.get(key);
    if (!n) { n = normalise(pages[i].text, opts.matchCase, opts.matchAccents); normCache.set(key, n); }
    return n;
  }

  /** Finds every match in the pages read so far. Keeps the current match when possible. */
  function run(jump = true) {
    const prevHit = hits[current];
    hits = []; pagesWithHits = 0;
    const q = normalise(query, opts.matchCase, opts.matchAccents).text;
    if (q) {
      for (let i = 0; i < ready; i++) {
        if (!pages[i]?.text) continue;
        const n = normPage(i), s = n.text;
        let from = 0, any = false;
        for (;;) {
          const at = s.indexOf(q, from);
          if (at < 0) break;
          from = at + 1;
          if (opts.wholeWords && ((at > 0 && WORD.test(s[at - 1])) || (at + q.length < s.length && WORD.test(s[at + q.length])))) continue;
          hits.push({ page: i, start: n.map[at], end: n.map[at + q.length - 1] + 1 });
          any = true;
          if (hits.length >= 20000) break;
        }
        if (any) pagesWithHits++;
        if (hits.length >= 20000) break;
      }
    }
    if (!hits.length) current = -1;
    else if (prevHit) { const k = hits.findIndex((h) => h.page === prevHit.page && h.start === prevHit.start); current = k >= 0 ? k : Math.min(current, hits.length - 1); }
    else if (jump) {
      // first match at or after the page being viewed
      const here = viewer.currentPageNumber - 1;
      current = Math.max(0, hits.findIndex((h) => h.page >= here));
    } else current = -1;
    paintVisible();
    if (jump && current >= 0 && !prevHit) reveal();
    onUpdate?.();
  }

  /* ---- drawing the matches on the page */
  const textDivs = (pv) => {
    const div = pv?.textLayer?.div;
    return div ? div.querySelectorAll("span:not(.markedContent)") : null;
  };
  function clearPaint() { for (const el of document.querySelectorAll(".fl-hits")) el.remove(); }
  function paintPage(i) {
    const pv = viewer.getPageView(i);
    if (!pv?.div) return;
    pv.div.querySelector(":scope > .fl-hits")?.remove();
    const mine = hits.map((h, k) => [h, k]).filter(([h, k]) => h.page === i && (opts.highlightAll || k === current));
    if (!mine.length || !pages[i]) return;
    const spans = textDivs(pv);
    if (!spans?.length) return;
    const box = pv.div.getBoundingClientRect(), layer = document.createElement("div");
    layer.className = "fl-hits";
    const { piece, offset } = pages[i];
    for (const [h, k] of mine) {
      // the match may run over several pieces of text: draw each part
      let a = h.start;
      while (a < h.end) {
        if (piece[a] < 0) { a++; continue; }
        const p = piece[a];
        let b = a;
        while (b < h.end && piece[b] === p) b++;
        const node = spans[p]?.firstChild;
        if (node && node.nodeType === 3) {
          const r = document.createRange();
          const s0 = Math.min(offset[a], node.length), s1 = Math.min(offset[b - 1] + 1, node.length);
          if (s1 > s0) {
            r.setStart(node, s0); r.setEnd(node, s1);
            for (const rc of r.getClientRects()) {
              if (rc.width < 0.5) continue;
              const m = document.createElement("div");
              m.className = "fl-hit" + (k === current ? " on" : "");
              Object.assign(m.style, { left: rc.left - box.left - 1 + "px", top: rc.top - box.top + "px", width: rc.width + 2 + "px", height: rc.height + "px" });
              layer.append(m);
            }
          }
        }
        a = b;
      }
    }
    pv.div.append(layer);
  }
  function paintVisible() {
    clearPaint();
    if (!query) return;
    const seen = new Set(hits.map((h) => h.page));
    for (const i of seen) if (viewer.getPageView(i)?.textLayer?.div?.childElementCount) paintPage(i);
  }

  /** Scrolls the current match into the middle of the view. */
  function reveal() {
    const h = hits[current];
    if (!h) return;
    const pv = viewer.getPageView(h.page);
    const show = () => {
      paintPage(h.page);
      const el = pv.div.querySelector(".fl-hit.on");
      if (!el) return false;
      const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < c.top + 60 || r.bottom > c.bottom - 60) container.scrollTop += r.top - c.top - c.height / 2 + r.height / 2;
      if (r.left < c.left + 20 || r.right > c.right - 20) container.scrollLeft += r.left - c.left - c.width / 2 + r.width / 2;
      return true;
    };
    if (pv?.textLayer?.div?.childElementCount && show()) return;
    viewer.scrollPageIntoView({ pageNumber: h.page + 1 });
    pendingReveal = h;
  }
  let pendingReveal = null;

  return {
    reset,
    /** Called when PDF.js has drawn a page's text: draws the matches there. */
    onTextLayer(pageNumber) {
      const i = pageNumber - 1;
      if (!query) return;
      if (pendingReveal && pendingReveal.page === i && pendingReveal === hits[current]) { pendingReveal = null; reveal(); }
      else if (hits.some((h) => h.page === i)) paintPage(i);
    },
    async search(q, options) {
      if (q !== query) { hits = []; current = -1; }
      query = q; if (options) opts = { ...opts, ...options };
      if (!pdf) return;
      if (!building && q) build();
      run(true);
    },
    setOptions(options) { opts = { ...opts, ...options }; normCache.clear(); run(false); if (current < 0 && hits.length) { current = 0; paintVisible(); } },
    step(dir) {
      if (!hits.length) return;
      current = current < 0 ? (dir > 0 ? 0 : hits.length - 1) : (current + dir + hits.length) % hits.length;
      paintVisible(); reveal(); onUpdate?.();
    },
    go(k) { if (hits[k]) { current = k; paintVisible(); reveal(); onUpdate?.(); } },
    clear() { query = ""; hits = []; current = -1; clearPaint(); onUpdate?.(); },
    warm() { if (pdf && !building) build(); },
    /** State for the find box: counts, progress and the list of results with their context. */
    state(limit = 300) {
      const list = hits.slice(0, limit).map((h, k) => {
        const s = pages[h.page].text, a = Math.max(0, h.start - 40), b = Math.min(s.length, h.end + 60);
        return { k, page: h.page + 1, before: (a > 0 ? "…" : "") + s.slice(a, h.start).replace(/\s+/g, " ").trimStart(), match: s.slice(h.start, h.end), after: s.slice(h.end, b).replace(/\s+/g, " ") + (b < s.length ? "…" : "") };
      });
      return { query, total: hits.length, current, pages: pagesWithHits, ready, of: pdf?.numPages || 0, list, more: Math.max(0, hits.length - limit), capped: hits.length >= 20000 };
    },
  };
}
