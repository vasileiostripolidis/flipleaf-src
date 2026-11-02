// Signature studio: type, draw, import a photo/scan, generate variations, and keep saved signatures.
// Everything runs locally; signatures are stored only on this device.
import { addStrings, t, LANG } from "./i18n.js";

addStrings({
  sigTitle: "Signature", sigType: "Type", sigDraw: "Draw", sigImport: "Import", sigGenerate: "Generate", sigSaved: "My signatures",
  sigName: "Your name", sigLatin: "Use Latin letters", sigInk: "Ink", sigBlack: "Black", sigBlue: "Blue", sigNavy: "Dark blue",
  sigStyleScript: "Calligraphy", sigStyleHand: "Handwriting", sigStyleMarker: "Marker", sigStyleClassic: "Classic",
  sigPen: "Pen", sigMarker: "Marker", sigThin: "Thin", sigMedium: "Medium", sigBold: "Bold", sigClear: "Clear", sigUndo: "Undo stroke",
  sigDrawHint: "Sign in the box with your mouse, trackpad, pen or finger.",
  sigImportHint: "Choose a photo or scan of your signature on white paper. The background is removed automatically.",
  sigChoose: "Choose image…", sigSensitivity: "Background removal", sigRecolor: "Use the ink color",
  sigGenerateHint: "Creates signature variations from your name — different styles, slants and flourishes. Pick the one you like.",
  sigMore: "More variations", sigRemember: "Save to my signatures", sigPlace: "Place signature", sigNone: "No saved signatures yet.",
  sigDefault: "Default", sigEmpty: "Type your name, draw, or import a signature first.",
  sigPlaceHint: "Click on the page where the signature should go. Esc cancels.", sigPlaced: "Signature placed. Drag it or resize it from a corner.",
  sigInsert: "Signature",
}, {
  sigTitle: "Υπογραφή", sigType: "Πληκτρολόγηση", sigDraw: "Σχεδίαση", sigImport: "Εισαγωγή", sigGenerate: "Αυτόματη δημιουργία", sigSaved: "Οι υπογραφές μου",
  sigName: "Το όνομά σου", sigLatin: "Με λατινικούς χαρακτήρες", sigInk: "Μελάνι", sigBlack: "Μαύρο", sigBlue: "Μπλε", sigNavy: "Σκούρο μπλε",
  sigStyleScript: "Καλλιγραφική", sigStyleHand: "Χειρόγραφη", sigStyleMarker: "Μαρκαδόρος", sigStyleClassic: "Κλασική",
  sigPen: "Πένα", sigMarker: "Μαρκαδόρος", sigThin: "Λεπτή", sigMedium: "Μεσαία", sigBold: "Έντονη", sigClear: "Καθαρισμός", sigUndo: "Αναίρεση γραμμής",
  sigDrawHint: "Υπόγραψε στο πλαίσιο με ποντίκι, trackpad, γραφίδα ή δάχτυλο.",
  sigImportHint: "Διάλεξε φωτογραφία ή σάρωση της υπογραφής σου σε λευκό χαρτί. Το φόντο αφαιρείται αυτόματα.",
  sigChoose: "Επιλογή εικόνας…", sigSensitivity: "Αφαίρεση φόντου", sigRecolor: "Χρώμα μελανιού",
  sigGenerateHint: "Δημιουργεί παραλλαγές υπογραφής από το όνομά σου, με διαφορετικά στυλ, κλίσεις και τελειώματα. Διάλεξε αυτή που σου αρέσει.",
  sigMore: "Περισσότερες παραλλαγές", sigRemember: "Αποθήκευση στις υπογραφές μου", sigPlace: "Τοποθέτηση υπογραφής", sigNone: "Δεν υπάρχουν αποθηκευμένες υπογραφές.",
  sigDefault: "Προεπιλογή", sigEmpty: "Γράψε το όνομά σου, σχεδίασε ή φέρε μια υπογραφή πρώτα.",
  sigPlaceHint: "Κάνε κλικ στη σελίδα εκεί που θα μπει η υπογραφή. Esc για ακύρωση.", sigPlaced: "Η υπογραφή μπήκε. Σύρε τη ή άλλαξε μέγεθος από μια γωνία.",
  sigInsert: "Υπογραφή",
});

const INKS = [["sigBlack", "#141414"], ["sigBlue", "#1f3fa6"], ["sigNavy", "#0d1b4d"]];
const FAMILY = {
  script: '"FL Great Vibes", "FL Garamond", serif',
  hand: '"FL Dancing", "FL Garamond", serif',
  marker: '"FL Caveat", "FL Garamond", sans-serif',
  classic: '"FL Garamond", serif',
};
const STYLES = [["script", "sigStyleScript", 1.0], ["hand", "sigStyleHand", 0.86], ["marker", "sigStyleMarker", 0.92], ["classic", "sigStyleClassic", 0.82]];

/** Greek → Latin (ELOT 743, simplified), for script fonts that have no Greek letters. */
function greeklish(s) {
  const pairs = { "ου": "ou", "Ου": "Ou", "ΟΥ": "OU", "αι": "ai", "ει": "ei", "οι": "oi", "μπ": "b", "Μπ": "B", "ντ": "nt", "γκ": "gk", "γγ": "ng", "τσ": "ts", "τζ": "tz" };
  const map = { α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o" };
  let out = s.normalize("NFD").replace(/\p{M}/gu, "");
  for (const [g, l] of Object.entries(pairs)) out = out.split(g).join(l);
  return [...out].map((c) => {
    const low = c.toLowerCase(), r = map[low];
    if (!r) return c;
    return c === low ? r : r[0].toUpperCase() + r.slice(1);
  }).join("");
}
const hasGreek = (s) => /[Ͱ-Ͽἀ-῿]/.test(s);

let fontsReady = null;
function loadFonts() {
  if (fontsReady) return fontsReady;
  const base = new URL("./vendor/fonts/signature/", import.meta.url).href;
  const faces = [
    ["FL Great Vibes", "great-vibes-latin-400-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F"],
    ["FL Great Vibes", "great-vibes-latin-ext-400-normal.woff2", "U+0100-024F,U+1E00-1EFF"],
    ["FL Dancing", "dancing-script-latin-600-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F"],
    ["FL Dancing", "dancing-script-latin-ext-600-normal.woff2", "U+0100-024F,U+1E00-1EFF"],
    ["FL Caveat", "caveat-latin-500-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F"],
    ["FL Caveat", "caveat-latin-ext-500-normal.woff2", "U+0100-024F,U+1E00-1EFF"],
    ["FL Caveat", "caveat-cyrillic-500-normal.woff2", "U+0400-045F,U+0490-0491,U+04B0-04B1"],
    ["FL Garamond", "eb-garamond-latin-500-italic.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F"],
    ["FL Garamond", "eb-garamond-latin-ext-500-italic.woff2", "U+0100-024F,U+1E00-1EFF"],
    ["FL Garamond", "eb-garamond-greek-500-italic.woff2", "U+0370-03FF"],
    ["FL Garamond", "eb-garamond-greek-ext-500-italic.woff2", "U+1F00-1FFF"],
  ];
  fontsReady = Promise.all(faces.map(async ([family, file, range]) => {
    const f = new FontFace(family, `url(${base}${file})`, { unicodeRange: range });
    document.fonts.add(f);
    try { await f.load(); } catch {}
  }));
  return fontsReady;
}

/* ------------------------------------------------------------ storage */

const KEY = "flipleaf.signatures.v2";
export const sigStore = {
  list() {
    try {
      const v2 = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(v2)) return v2;
      const old = JSON.parse(localStorage.getItem("flipleaf.signatures")) || []; // migrate 1.x
      return old.map((url, i) => ({ id: "s" + Date.now() + i, url, created: Date.now() }));
    } catch { return []; }
  },
  save(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12))); return true; } catch { return false; } },
  add(url) {
    const list = this.list().filter((s) => s.url !== url);
    list.unshift({ id: "s" + Date.now(), url, created: Date.now() });
    return this.save(list);
  },
  remove(id) { this.save(this.list().filter((s) => s.id !== id)); },
  makeDefault(id) { const l = this.list(); const i = l.findIndex((s) => s.id === id); if (i > 0) { l.unshift(...l.splice(i, 1)); this.save(l); } },
};

/* ------------------------------------------------------------ drawing helpers */

/** Crops transparent margins. */
function trim(src, pad = 10) {
  const { width: w, height: h } = src;
  const d = src.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d").drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Renders a name in a style. Options add slant, letter jitter and a flourish. */
function renderName(text, { style = "script", color = "#141414", size = 120, slant = 0, jitter = 0, flourish = 0, seed = 1 } = {}) {
  const fam = FAMILY[style];
  const scale = STYLES.find((s) => s[0] === style)?.[2] || 1;
  const px = Math.round(size * scale);
  const c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = `${px}px ${fam}`;
  const w = Math.ceil(g.measureText(text).width) + px * 2, h = Math.round(px * 2.4);
  c.width = w; c.height = h;
  g.font = `${px}px ${fam}`; g.fillStyle = color; g.strokeStyle = color; g.textBaseline = "alphabetic";
  g.setTransform(1, 0, -slant, 1, px * 0.6 + slant * h * 0.6, 0);
  const r = rand(seed), base = h * 0.62;
  if (!jitter) g.fillText(text, 0, base);
  else {
    let x = 0;
    for (const ch of text) {
      const dy = (r() - 0.5) * jitter * px * 0.12, rot = (r() - 0.5) * jitter * 0.08;
      g.save(); g.translate(x, base + dy); g.rotate(rot); g.fillText(ch, 0, 0); g.restore();
      x += g.measureText(ch).width * (1 - jitter * 0.04);
    }
  }
  if (flourish) {
    const tw = g.measureText(text).width;
    g.setTransform(1, 0, 0, 1, px * 0.6, 0);
    g.lineWidth = Math.max(2, px * 0.045); g.lineCap = "round";
    g.beginPath();
    const y = base + px * 0.22;
    if (flourish === 1) { g.moveTo(-px * 0.1, y + px * 0.05); g.bezierCurveTo(tw * 0.3, y + px * 0.25, tw * 0.7, y - px * 0.05, tw + px * 0.35, y - px * 0.3); }
    else if (flourish === 2) { g.moveTo(tw * 0.15, y); g.quadraticCurveTo(tw * 0.6, y + px * 0.18, tw * 1.02, y - px * 0.02); }
    else { g.moveTo(tw * 0.05, y + px * 0.1); g.bezierCurveTo(tw * 0.4, y - px * 0.05, tw * 0.55, y + px * 0.35, tw + px * 0.2, y + px * 0.02); g.bezierCurveTo(tw + px * 0.4, y - px * 0.08, tw + px * 0.25, y - px * 0.3, tw + px * 0.05, y - px * 0.12); }
    g.stroke();
  }
  return trim(c, 12);
}

/* ------------------------------------------------------------ the studio */

export function createSignatureStudio({ dialog, icon, toast, store }) {
  async function open() {
    await loadFonts();
    const body = document.createElement("div");
    body.className = "sigstudio";
    body.innerHTML = `
      <div class="tabs">
        <button type="button" data-tab="type">${t("sigType")}</button>
        <button type="button" data-tab="draw">${t("sigDraw")}</button>
        <button type="button" data-tab="import">${t("sigImport")}</button>
        <button type="button" data-tab="generate">${t("sigGenerate")}</button>
        <button type="button" data-tab="saved">${t("sigSaved")}</button>
      </div>
      <div class="sigink"><span class="muted small">${t("sigInk")}</span>${INKS.map(([k, c], i) => `<button type="button" class="fl-swatch${i === 0 ? " on" : ""}" data-ink="${c}" title="${t(k)}" style="background:${c}"></button>`).join("")}</div>
      <section data-pane="type">
        <div class="frow"><input class="field" data-name placeholder="${t("sigName")}" autocomplete="name" style="flex:1"><label class="small" data-latinwrap hidden><input type="checkbox" data-latin checked> ${t("sigLatin")}</label></div>
        <div class="sigstyles"></div>
      </section>
      <section data-pane="draw" hidden>
        <p class="muted small" style="margin:0 0 6px">${t("sigDrawHint")}</p>
        <canvas class="sigpad" width="1100" height="380"></canvas>
        <div class="sigrow">
          <div class="seg" data-pen><button type="button" class="on" data-v="pen">${t("sigPen")}</button><button type="button" data-v="marker">${t("sigMarker")}</button></div>
          <div class="seg" data-width><button type="button" data-v="2.2">${t("sigThin")}</button><button type="button" class="on" data-v="3.6">${t("sigMedium")}</button><button type="button" data-v="5.5">${t("sigBold")}</button></div>
          <div class="spacer"></div>
          <button type="button" class="btn secondary sm" data-undo>${icon("undo-2", 14)}<span>${t("sigUndo")}</span></button>
          <button type="button" class="btn secondary sm" data-clear>${t("sigClear")}</button>
        </div>
      </section>
      <section data-pane="import" hidden>
        <p class="muted small" style="margin:0 0 8px">${t("sigImportHint")}</p>
        <div class="frow"><button type="button" class="btn secondary" data-pick>${icon("image-plus", 16)}<span>${t("sigChoose")}</span></button>
          <label class="frow small"><span>${t("sigSensitivity")}</span><input type="range" min="-60" max="60" value="0" data-sens></label>
          <label class="small"><input type="checkbox" data-recolor checked> ${t("sigRecolor")}</label></div>
        <div class="sigpreview checker" data-ipreview></div>
      </section>
      <section data-pane="generate" hidden>
        <p class="muted small" style="margin:0 0 8px">${t("sigGenerateHint")}</p>
        <div class="frow"><input class="field" data-gname placeholder="${t("sigName")}" style="flex:1"><button type="button" class="btn secondary" data-gen>${t("sigMore")}</button></div>
        <div class="siggrid" data-gengrid></div>
      </section>
      <section data-pane="saved" hidden><div class="siggrid saved" data-savedgrid></div></section>
      <label class="frow small sigremember"><input type="checkbox" data-remember checked> ${t("sigRemember")}</label>`;

    const $ = (s) => body.querySelector(s);
    let ink = INKS[0][1], tab = "type", typedStyle = "script", chosen = null; // chosen = canvas or {url}
    const nameIn = $("[data-name]"), gName = $("[data-gname]");
    nameIn.value = gName.value = store.get("sigName", "");

    // ---------- tabs
    const show = (name) => {
      tab = name;
      for (const b of body.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === name);
      for (const s of body.querySelectorAll("[data-pane]")) s.hidden = s.dataset.pane !== name;
      $(".sigink").hidden = name === "saved";
      $(".sigremember").hidden = name === "saved";
      if (name === "type") { renderStyles(); nameIn.focus(); }
      if (name === "generate") { if (!gName.value) gName.value = nameIn.value; generate(); }
      if (name === "saved") renderSaved();
    };
    for (const b of body.querySelectorAll("[data-tab]")) b.onclick = () => show(b.dataset.tab);
    for (const b of body.querySelectorAll("[data-ink]")) b.onclick = () => {
      ink = b.dataset.ink;
      body.querySelectorAll("[data-ink]").forEach((x) => x.classList.toggle("on", x === b));
      if (tab === "type") renderStyles(); if (tab === "generate") generate(true); if (tab === "import") processImport(); if (tab === "draw") redrawPad();
    };

    // ---------- type
    const latinWrap = $("[data-latinwrap]"), latin = $("[data-latin]");
    const typedText = () => { const n = nameIn.value.trim(); return hasGreek(n) && latin.checked ? greeklish(n) : n; };
    function renderStyles() {
      latinWrap.hidden = !hasGreek(nameIn.value);
      const box = $(".sigstyles"); box.replaceChildren();
      const txt = typedText() || (LANG === "el" ? "Υπογραφή" : "Signature");
      for (const [key, label] of STYLES) {
        const b = document.createElement("button"); b.type = "button"; b.className = "sigcard" + (key === typedStyle ? " on" : "");
        const text = key === "classic" ? (nameIn.value.trim() || txt) : txt;
        const c = renderName(text, { style: key, color: ink, size: 90 });
        if (c) { c.className = "sigimg"; b.append(c); }
        const cap = document.createElement("span"); cap.textContent = t(label); b.append(cap);
        b.onclick = () => { typedStyle = key; renderStyles(); };
        box.append(b);
      }
    }
    nameIn.oninput = () => { store.set("sigName", nameIn.value); renderStyles(); };
    latin.onchange = renderStyles;

    // ---------- draw (smoothed strokes, pressure-like width from speed)
    const pad = $(".sigpad"), pg = pad.getContext("2d");
    let strokes = [], cur = null, penMode = "pen", baseW = 3.6;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height, t: performance.now(), p: e.pressure || 0.5 }; };
    function drawStroke(g, s, color) {
      const pts = s.points; if (!pts.length) return;
      g.strokeStyle = g.fillStyle = color; g.lineCap = g.lineJoin = "round";
      if (pts.length === 1) { g.beginPath(); g.arc(pts[0].x, pts[0].y, s.w, 0, 7); g.fill(); return; }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        let w = s.w;
        if (s.mode === "pen") { const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t); w = s.w * Math.max(0.45, Math.min(1.35, 1.25 - v * 0.35)) * (0.7 + (b.p || 0.5) * 0.6); }
        g.lineWidth = (s.lw = s.lw ? s.lw * 0.6 + w * 0.4 : w);
        const m0 = i > 1 ? { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 } : a, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        g.beginPath(); g.moveTo(m0.x, m0.y); g.quadraticCurveTo(a.x, a.y, m1.x, m1.y); g.stroke();
      }
      s.lw = 0;
    }
    function redrawPad() { pg.clearRect(0, 0, pad.width, pad.height); for (const s of strokes) drawStroke(pg, s, ink); }
    pad.onpointerdown = (e) => { cur = { mode: penMode, w: baseW, points: [pos(e)] }; strokes.push(cur); pad.setPointerCapture(e.pointerId); };
    pad.onpointermove = (e) => { if (!cur) return; cur.points.push(pos(e)); redrawPad(); };
    pad.onpointerup = () => { cur = null; redrawPad(); };
    $("[data-clear]").onclick = () => { strokes = []; redrawPad(); };
    $("[data-undo]").onclick = () => { strokes.pop(); redrawPad(); };
    for (const seg of body.querySelectorAll(".seg")) for (const b of seg.querySelectorAll("button")) b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      if (seg.dataset.pen !== undefined) penMode = b.dataset.v; else baseW = +b.dataset.v;
    };

    // ---------- import a photo / scan
    let srcImage = null;
    const iprev = $("[data-ipreview]");
    $("[data-pick]").onclick = () => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
      input.onchange = async () => { const f = input.files[0]; if (!f) return; srcImage = await createImageBitmap(f); processImport(); };
      input.click();
    };
    $("[data-sens]").oninput = () => processImport();
    $("[data-recolor]").onchange = () => processImport();
    let imported = null;
    function processImport() {
      if (!srcImage) return;
      const max = 1600, s = Math.min(1, max / Math.max(srcImage.width, srcImage.height));
      const c = document.createElement("canvas"); c.width = Math.round(srcImage.width * s); c.height = Math.round(srcImage.height * s);
      const g = c.getContext("2d"); g.drawImage(srcImage, 0, 0, c.width, c.height);
      const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
      // Otsu threshold on luminance
      const hist = new Uint32Array(256), lum = new Uint8Array(c.width * c.height);
      for (let i = 0, k = 0; i < d.length; i += 4, k++) { const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; lum[k] = l; hist[l]++; }
      let sum = 0, total = lum.length; for (let i = 0; i < 256; i++) sum += i * hist[i];
      let sB = 0, wB = 0, best = 0, thr = 128;
      for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = i; } }
      thr = Math.max(20, Math.min(235, thr + +$("[data-sens]").value));
      const recolor = $("[data-recolor]").checked, [r, gg, b] = [1, 3, 5].map((k) => parseInt(ink.slice(k, k + 2), 16));
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        const a = Math.max(0, Math.min(255, (thr - lum[k]) * 255 / Math.max(12, thr * 0.45)));
        if (recolor) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; }
        d[i + 3] = a;
      }
      g.putImageData(img, 0, 0);
      imported = trim(c, 8);
      iprev.replaceChildren();
      if (imported) { imported.className = "sigimg"; iprev.append(imported); }
    }

    // ---------- generate variations
    let genSeed = (Date.now() & 0xffff) || 7, generated = [], genPick = null;
    function generate(keepSeed = false) {
      const name = gName.value.trim() || nameIn.value.trim();
      const grid = $("[data-gengrid]"); grid.replaceChildren();
      if (!name) return;
      const base = hasGreek(name) ? greeklish(name) : name;
      const parts = base.split(/\s+/).filter(Boolean);
      const forms = [base, parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : base, parts.length > 1 ? parts.at(-1) : base, parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : base];
      if (!keepSeed) genSeed++;
      const r = rand(genSeed * 7919);
      generated = [];
      for (let i = 0; i < 6; i++) {
        const style = ["script", "hand", "script", "marker", "hand", "script"][i];
        const opts = { style, color: ink, size: 92, slant: 0.08 + r() * 0.22, jitter: style === "marker" ? 0.6 : r() * 1.1, flourish: Math.floor(r() * 4), seed: genSeed * 31 + i };
        const text = forms[Math.floor(r() * forms.length)];
        const c = renderName(text, opts);
        if (!c) continue;
        generated.push(c);
        const b = document.createElement("button"); b.type = "button"; b.className = "sigcard";
        c.className = "sigimg"; b.append(c);
        b.onclick = () => { genPick = c; grid.querySelectorAll(".sigcard").forEach((x) => x.classList.toggle("on", x === b)); };
        grid.append(b);
      }
    }
    $("[data-gen]").onclick = () => generate();
    gName.oninput = () => { clearTimeout(gName._t); gName._t = setTimeout(() => generate(true), 250); };

    // ---------- saved
    let savedPick = null;
    function renderSaved() {
      const grid = $("[data-savedgrid]"); grid.replaceChildren();
      const list = sigStore.list();
      if (!list.length) { grid.innerHTML = `<p class="muted small">${t("sigNone")}</p>`; return; }
      list.forEach((s, i) => {
        const b = document.createElement("div"); b.className = "sigcard" + (savedPick?.id === s.id ? " on" : "");
        b.innerHTML = `<img class="sigimg" alt=""><div class="sigactions">${i === 0 ? `<span class="small muted">${t("sigDefault")}</span>` : `<button type="button" class="btn icon sm" data-star title="${t("sigDefault")}">${icon("check", 14)}</button>`}<button type="button" class="btn icon sm" data-del title="Delete">${icon("trash-2", 14)}</button></div>`;
        b.querySelector("img").src = s.url;
        b.onclick = (e) => {
          if (e.target.closest("[data-del]")) { sigStore.remove(s.id); if (savedPick?.id === s.id) savedPick = null; renderSaved(); return; }
          if (e.target.closest("[data-star]")) { sigStore.makeDefault(s.id); renderSaved(); return; }
          savedPick = s; renderSaved();
        };
        b.ondblclick = () => { savedPick = s; document.getElementById("dlg").close("place"); };
        grid.append(b);
      });
    }

    // start on saved signatures if there are any
    show(sigStore.list().length ? "saved" : "type");
    if (sigStore.list().length) { savedPick = sigStore.list()[0]; renderSaved(); }

    document.getElementById("dlg").classList.add("wide");
    const result = await dialog({ title: t("sigTitle"), body, buttons: [{ label: t("cancel"), value: "cancel", kind: "secondary" }, { label: t("sigPlace"), value: "place", kind: "primary" }] });
    document.getElementById("dlg").classList.remove("wide");
    if (result !== "place") return null;

    let canvas = null;
    if (tab === "saved") { if (savedPick) return savedPick.url; }
    else if (tab === "type") { const txt = typedStyle === "classic" ? nameIn.value.trim() : typedText(); if (txt) canvas = renderName(txt, { style: typedStyle, color: ink, size: 140 }); }
    else if (tab === "draw") { if (strokes.length) { const c = document.createElement("canvas"); c.width = pad.width; c.height = pad.height; const g = c.getContext("2d"); for (const s of strokes) drawStroke(g, s, ink); canvas = trim(c, 10); } }
    else if (tab === "import") canvas = imported;
    else if (tab === "generate") canvas = genPick || generated[0] || null;
    if (!canvas) { toast(t("sigEmpty")); return null; }
    const url = canvas.toDataURL("image/png");
    if ($("[data-remember]").checked) sigStore.add(url);
    return url;
  }
  return { open };
}

/** data: URL → File, without fetch() (the desktop app's security policy blocks fetching data: URLs). */
export function urlToFile(url, name = "signature.png") {
  const [head, b64] = url.split(",");
  const type = head.match(/data:([^;]+)/)?.[1] || "image/png";
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}
