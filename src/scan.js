// Document scanner: turns photos of paper pages into clean, straight PDF pages (like a scanner app).
// Finds the page in the photo, lets the user adjust its four corners, straightens the perspective,
// whitens the paper and removes shadows. Everything runs on this device.

import { icon } from "./icons.js";

const A4 = [1654, 2339];            // 200 dpi
const WORK = 3200;                  // longest side used for the final page
const VIEW = 1400;                  // longest side kept for editing and preview
const MODES = ["auto", "gray", "bw", "original"];

/* ------------------------------------------------------------------ images */

async function decode(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}
const pixels = (c) => { const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return { data: d.data, w: c.width, h: c.height }; };

/*! javascript-obfuscator:disable */
/* ------------------------------------------------------------------ finding the page */

function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = i; }
  }
  return thr;
}

function morph(mask, w, h, r, dilate) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); const m = mask[y * w + xx]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); const m = tmp[yy * w + x]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
    out[y * w + x] = v;
  }
  return out;
}

function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const area = (q) => { let a = 0; for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };

/** Top-left, top-right, bottom-right, bottom-left. */
function order(q) {
  const s = q.map((p) => p[0] + p[1]), d = q.map((p) => p[0] - p[1]);
  const tl = q[s.indexOf(Math.min(...s))], br = q[s.indexOf(Math.max(...s))];
  const tr = q[d.indexOf(Math.max(...d))], bl = q[d.indexOf(Math.min(...d))];
  const out = [tl, tr, br, bl];
  return new Set(out).size === 4 ? out : null;
}

/** Largest bright, paper-like area of a mask → its four corners (in mask pixels), or null. */
function quadOf(mask, w, h) {
  mask = morph(morph(mask, w, h, 2, false), w, h, 2, true); // open: cut thin links to other bright things
  // fill the holes the printed text leaves in the paper
  const outside = new Uint8Array(w * h), stack = [];
  const seed = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i - x) / w;
    if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (y > 0) seed(i - w); if (y < h - 1) seed(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!outside[i]) mask[i] = 1;
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let size = 0; label[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w; size++;
      if (x > 0 && mask[j - 1] && label[j - 1] < 0) { label[j - 1] = id; stack.push(j - 1); }
      if (x < w - 1 && mask[j + 1] && label[j + 1] < 0) { label[j + 1] = id; stack.push(j + 1); }
      if (j >= w && mask[j - w] && label[j - w] < 0) { label[j - w] = id; stack.push(j - w); }
      if (j + w < w * h && mask[j + w] && label[j + w] < 0) { label[j + w] = id; stack.push(j + w); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (best < 0 || bestSize < w * h * 0.06 || bestSize > w * h * 0.985) return null;
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (label[i] === best && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] !== best || label[i + 1] !== best || label[i - w] !== best || label[i + w] !== best)) edge.push([x, y]);
  }
  let poly = hull(edge);
  if (poly.length < 4) return null;
  if (poly.length > 40) { const step = poly.length / 40; poly = Array.from({ length: 40 }, (_, i) => poly[Math.floor(i * step)]); }
  let quad = null, max = 0;
  const n = poly.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let e = c + 1; e < n; e++) {
    const q = [poly[a], poly[b], poly[c], poly[e]], sz = area(q);
    if (sz > max) { max = sz; quad = q; }
  }
  if (!quad || max < bestSize * 0.7) return null;
  return order(quad);
}

/** How well a quad's sides follow edges in the photo (average contrast across its sides). */
function edgeScore(q, grad, w, h) {
  let sum = 0, n = 0;
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = q[k], [x1, y1] = q[(k + 1) % 4], len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(8, Math.round(len));
    for (let i = 1; i < steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps), y = Math.round(y0 + ((y1 - y0) * i) / steps);
      let m = 0; // allow a pixel of slack
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.max(m, grad[yy * w + xx]); }
      sum += m; n++;
    }
  }
  return n ? sum / n : 0;
}

/** Finds the four corners of the sheet of paper, as fractions of the photo's width and height. */
export function detect(canvas) {
  const k = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
  const w = Math.max(8, Math.round(canvas.width * k)), h = Math.max(8, Math.round(canvas.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true }); g.filter = "blur(1px)"; g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, N = w * h;
  const lum = new Float32Array(N), sat = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = d[p], gg = d[p + 1], b = d[p + 2];
    lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b; sat[i] = Math.max(r, gg, b) - Math.min(r, gg, b);
  }
  // contrast map for judging candidates
  const grad = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = lum[i + 1] - lum[i - 1] + (sat[i - 1] - sat[i + 1]) * 0.5, gy = lum[i + w] - lum[i - w] + (sat[i - w] - sat[i + w]) * 0.5;
    grad[i] = Math.hypot(gx, gy);
  }
  // paper is light and has little colour; try several ways of telling it from the background
  const features = [
    (i) => lum[i],
    (i) => lum[i] - 1.4 * sat[i],
    (i) => 255 - sat[i] * 2.2,
  ];
  let best = null, bestScore = 0;
  for (const f of features) {
    const v = new Uint8Array(N), hist = new Uint32Array(256);
    for (let i = 0; i < N; i++) { v[i] = Math.max(0, Math.min(255, f(i))); hist[v[i]]++; }
    const thr = otsu(hist, N);
    for (const shift of [0, -18, 18]) {
      const mask = new Uint8Array(N);
      for (let i = 0; i < N; i++) mask[i] = v[i] > thr + shift ? 1 : 0;
      const q = quadOf(mask, w, h);
      if (!q) continue;
      const a = area(q) / N, score = edgeScore(q, grad, w, h) * (0.6 + Math.min(a, 0.9));
      if (score > bestScore) { bestScore = score; best = q; }
    }
  }
  if (!best) return [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]];
  return best.map(([x, y]) => [Math.min(1, Math.max(0, (x + 0.5) / w)), Math.min(1, Math.max(0, (y + 0.5) / h))]);
}

/* ------------------------------------------------------------------ straightening */

/** Homography that maps the rectangle (0,0)–(W,H) onto the quad (pixels). */
function homography(quad, W, H) {
  const src = [[0, 0], [W, 0], [W, H], [0, H]], A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let i = 0; i < 8; i++) { // Gaussian elimination
    let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < 8; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

function warp(src, quadN, W, H) {
  const q = quadN.map(([x, y]) => [x * src.w, y * src.h]);
  const [a, b, c, d, e, f, g, h] = homography(q, W, H);
  const out = new ImageData(W, H), o = out.data, s = src.data, sw = src.w, sh = src.h;
  for (let y = 0, p = 0; y < H; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < W; x++, p += 4) {
      const X = x + 0.5, den = g * X + h * Y + 1;
      let u = (a * X + b * Y + c) / den - 0.5, v = (d * X + e * Y + f) / den - 0.5;
      u = u < 0 ? 0 : u > sw - 1.001 ? sw - 1.001 : u; v = v < 0 ? 0 : v > sh - 1.001 ? sh - 1.001 : v;
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * sw + x0) * 4, j = i + sw * 4;
      for (let k = 0; k < 3; k++) {
        const top = s[i + k] + (s[i + 4 + k] - s[i + k]) * fx, bot = s[j + k] + (s[j + 4 + k] - s[j + k]) * fx;
        o[p + k] = top + (bot - top) * fy;
      }
      o[p + 3] = 255;
    }
  }
  return out;
}

/** Output size: A4, or the proportions of the photographed sheet. */
function outSize(quadN, src, paper, long) {
  const q = quadN.map(([x, y]) => [x * src.w, y * src.h]);
  const dist = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]);
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const landscape = w > h;
  if (paper === "a4") { const k = long / A4[1]; const [a, b] = [Math.round(A4[0] * k), Math.round(A4[1] * k)]; return landscape ? [b, a] : [a, b]; }
  const k = long / Math.max(w, h);
  return [Math.max(16, Math.round(w * k)), Math.max(16, Math.round(h * k))];
}

/* ------------------------------------------------------------------ cleaning up */

/** Brightness of the paper around every point (the text is ignored), one value per channel. */
function paperLight(img, block) {
  const { width: W, height: H, data } = img, gw = Math.ceil(W / block), gh = Math.ceil(H / block);
  const grid = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const vals = [[], [], []];
    for (let y = gy * block; y < Math.min(H, (gy + 1) * block); y += 2) for (let x = gx * block; x < Math.min(W, (gx + 1) * block); x += 2) {
      const p = (y * W + x) * 4; vals[0].push(data[p]); vals[1].push(data[p + 1]); vals[2].push(data[p + 2]);
    }
    for (let k = 0; k < 3; k++) { const v = vals[k].sort((m, n) => m - n); grid[k][gy * gw + gx] = v[Math.floor(v.length * 0.9)] || 255; }
  }
  // spread the lightest values (text-only blocks get the paper around them), then smooth
  for (const gch of grid) {
    for (let pass = 0; pass < 1; pass++) {
      const t = gch.slice();
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) m = Math.max(m, t[yy * gw + xx]); }
        gch[y * gw + x] = m;
      }
    }
    for (let pass = 0; pass < 1; pass++) {
      const t = gch.slice();
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) { s += t[yy * gw + xx]; n++; } }
        gch[y * gw + x] = s / n;
      }
    }
  }
  return { grid, gw, gh, block };
}

export function enhance(img, mode) {
  if (mode === "original") return img;
  const { width: W, height: H, data } = img;
  const L = paperLight(img, Math.max(6, Math.round(Math.max(W, H) / 110)));
  const { grid, gw, gh, block } = L;
  const curve = new Uint8ClampedArray(256); // deepen the ink a little; paper stays white
  for (let i = 0; i < 256; i++) curve[i] = 255 * Math.pow(Math.min(1, Math.max(0, (i - 12) / 228)), 1.35);
  for (let y = 0, p = 0; y < H; y++) {
    const gyf = Math.min(gh - 1.001, Math.max(0, (y + 0.5) / block - 0.5)), gy = gyf | 0, fy = gyf - gy;
    for (let x = 0; x < W; x++, p += 4) {
      const gxf = Math.min(gw - 1.001, Math.max(0, (x + 0.5) / block - 0.5)), gx = gxf | 0, fx = gxf - gx;
      const i00 = gy * gw + gx, i01 = gx + 1 < gw ? i00 + 1 : i00, i10 = gy + 1 < gh ? i00 + gw : i00, i11 = gy + 1 < gh ? i01 + gw : i01;
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      const g0 = grid[0], g1 = grid[1], g2 = grid[2];
      const b0 = Math.max(24, g0[i00] * w00 + g0[i01] * w01 + g0[i10] * w10 + g0[i11] * w11);
      const b1 = Math.max(24, g1[i00] * w00 + g1[i01] * w01 + g1[i10] * w10 + g1[i11] * w11);
      const b2 = Math.max(24, g2[i00] * w00 + g2[i01] * w01 + g2[i10] * w10 + g2[i11] * w11);
      let r = Math.min(255, (data[p] * 255) / b0), g = Math.min(255, (data[p + 1] * 255) / b1), b = Math.min(255, (data[p + 2] * 255) / b2);
      if (mode === "auto") {
        r = curve[r | 0]; g = curve[g | 0]; b = curve[b | 0];
        const l = 0.299 * r + 0.587 * g + 0.114 * b; // a little more colour
        r = l + (r - l) * 1.3; g = l + (g - l) * 1.3; b = l + (b - l) * 1.3;
      } else {
        let l = curve[(0.299 * r + 0.587 * g + 0.114 * b) | 0];
        if (mode === "bw") l = l < 95 ? 0 : l > 185 ? 255 : ((l - 95) / 90) * 255;
        r = g = b = l;
      }
      data[p] = r; data[p + 1] = g; data[p + 2] = b;
    }
  }
  return img;
}

function rotate(img, quarter) {
  quarter = ((quarter % 4) + 4) % 4;
  if (!quarter) return img;
  const { width: W, height: H, data: s } = img, w = quarter % 2 ? H : W, h = quarter % 2 ? W : H;
  const out = new ImageData(w, h), d = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [nx, ny] = quarter === 1 ? [H - 1 - y, x] : quarter === 2 ? [W - 1 - x, H - 1 - y] : [y, W - 1 - x];
    const a = (y * W + x) * 4, b = (ny * w + nx) * 4;
    d[b] = s[a]; d[b + 1] = s[a + 1]; d[b + 2] = s[a + 2]; d[b + 3] = 255;
  }
  return out;
}

/*! javascript-obfuscator:enable */
/** One finished page: straightened, cleaned and turned, as JPEG bytes. */
async function render(page, long, srcCanvas) {
  const src = pixels(srcCanvas);
  const [W, H] = outSize(page.quad, src, page.paper, long);
  let img = warp(src, page.quad, W, H);
  img = rotate(enhance(img, page.mode), page.rot);
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ the scanner window */

/**
 * Opens the scanner with the given photos. Resolves to [{ bytes (JPEG), w, h }] in page order,
 * or null when cancelled. `more()` asks for more photos (File[]).
 */
export function openScanner(files, { t, more, toast, single = false }) {
  return new Promise((resolve) => {
    const pages = [];
    let cur = 0, paper = "a4";
    const root = document.createElement("div");
    root.className = "scan";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <header class="scan-top">
        <div class="scan-title">${icon("scan-line", 20)}<h2>${t("scanTitle")}</h2><span class="muted" data-r="count"></span></div>
        <div class="scan-actions"><button class="btn" data-r="cancel">${t("cancel")}</button><button class="btn primary" data-r="done">${icon("check", 16)}<span>${t(single ? "scanInsert" : "scanCreate")}</span></button></div>
      </header>
      <div class="scan-main">
        <section class="scan-pane">
          <div class="scan-label">${t("scanAdjust")}</div>
          <div class="scan-stage" data-r="stage"><canvas data-r="photo"></canvas><svg data-r="svg"></svg><canvas class="scan-loupe" data-r="loupe" width="150" height="150" hidden></canvas></div>
          <div class="scan-row">
            <button class="btn sm" data-r="detect">${icon("scan-line", 16)}<span>${t("scanDetect")}</span></button>
            <button class="btn sm" data-r="full">${icon("maximize", 16)}<span>${t("scanFull")}</span></button>
          </div>
        </section>
        <section class="scan-pane">
          <div class="scan-label">${t("scanResult")}</div>
          <div class="scan-stage result"><canvas data-r="result"></canvas><div class="scan-wait" data-r="wait" hidden></div></div>
          <div class="scan-row">
            <div class="seg" data-r="modes">${MODES.map((m) => `<button class="seg-b" data-m="${m}">${t("scanMode_" + m)}</button>`).join("")}</div>
            <button class="btn sm icon" data-r="rotl" title="${t("scanRotL")}">${icon("rotate-ccw", 16)}</button>
            <button class="btn sm icon" data-r="rotr" title="${t("scanRotR")}">${icon("rotate-cw", 16)}</button>
          </div>
          <div class="scan-row">
            <label class="frow"><span>${t("scanPaper")}</span><select class="field" data-r="paper"><option value="a4">A4</option><option value="auto">${t("scanAsShot")}</option></select></label>
            <button class="btn sm" data-r="all">${t("scanApplyAll")}</button>
          </div>
        </section>
      </div>
      <footer class="scan-pages" data-r="strip"></footer>`;
    const $ = (r) => root.querySelector(`[data-r="${r}"]`);
    document.body.append(root);
    const photo = $("photo"), svg = $("svg"), stage = $("stage"), result = $("result"), loupe = $("loupe");
    let view = { s: 1, ox: 0, oy: 0 };

    const close = (value) => { root.remove(); removeEventListener("keydown", onKey, true); resolve(value); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(null); } };
    addEventListener("keydown", onKey, true);

    async function add(list) {
      const at = pages.length;
      for (const file of list) {
        try {
          const canvas = await decode(file, VIEW);
          pages.push({ file, canvas, quad: detect(canvas), mode: "auto", rot: 0, paper, thumb: "" });
        } catch { toast(t("scanBadImage", { name: file.name }), 6000); }
      }
      if (!pages.length) return close(null);
      cur = pages.length > at ? at : Math.min(cur, pages.length - 1);
      show();
      for (let i = 0; i < pages.length; i++) if (!pages[i].thumb) await thumb(i);
    }

    /* ---- photo with the four corners */
    function drawPhoto() {
      const p = pages[cur], rect = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      const s = Math.min(rect.width / p.canvas.width, rect.height / p.canvas.height);
      view = { s, ox: (rect.width - p.canvas.width * s) / 2, oy: (rect.height - p.canvas.height * s) / 2 };
      photo.width = Math.round(rect.width * dpr); photo.height = Math.round(rect.height * dpr);
      photo.style.width = rect.width + "px"; photo.style.height = rect.height + "px";
      const g = photo.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, rect.width, rect.height);
      g.drawImage(p.canvas, view.ox, view.oy, p.canvas.width * s, p.canvas.height * s);
      drawQuad();
    }
    const toScreen = ([x, y]) => { const c = pages[cur].canvas; return [view.ox + x * c.width * view.s, view.oy + y * c.height * view.s]; };
    function drawQuad() {
      const q = pages[cur].quad.map(toScreen), rect = stage.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      svg.innerHTML = `<path class="shade" fill-rule="evenodd" d="M0 0H${rect.width}V${rect.height}H0Z M${q.map((p) => p.join(" ")).join(" L")}Z"/>
        <polygon class="edge" points="${q.map((p) => p.join(",")).join(" ")}"/>` +
        q.map((p, i) => `<circle class="corner" data-i="${i}" cx="${p[0]}" cy="${p[1]}" r="11"/>`).join("");
    }
    let drag = -1;
    svg.addEventListener("pointerdown", (e) => {
      const c = e.target.closest?.(".corner");
      let i = c ? +c.dataset.i : -1;
      if (i < 0) { // grab the nearest corner when the press is close enough
        const r = svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const q = pages[cur].quad.map(toScreen); let best = 1e9;
        q.forEach((p, k) => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < best) { best = dd; i = k; } });
        if (best > 44) return;
      }
      drag = i; svg.setPointerCapture(e.pointerId); e.preventDefault(); move(e);
    });
    const move = (e) => {
      if (drag < 0) return;
      const r = svg.getBoundingClientRect(), c = pages[cur].canvas;
      const x = Math.min(1, Math.max(0, (e.clientX - r.left - view.ox) / (c.width * view.s)));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top - view.oy) / (c.height * view.s)));
      pages[cur].quad[drag] = [x, y];
      drawQuad();
      // magnifier, so the corner can be put exactly on the paper's corner
      loupe.hidden = false;
      const g = loupe.getContext("2d"), z = 3, px = x * c.width, py = y * c.height, half = 75 / (z * view.s);
      g.fillStyle = "#000"; g.fillRect(0, 0, 150, 150);
      g.drawImage(c, px - half, py - half, half * 2, half * 2, 0, 0, 150, 150);
      g.strokeStyle = "#22c55e"; g.lineWidth = 2; g.beginPath(); g.moveTo(75, 60); g.lineTo(75, 90); g.moveTo(60, 75); g.lineTo(90, 75); g.stroke();
      loupe.style.left = (e.clientX - r.left < r.width / 2 ? r.width - 162 : 12) + "px";
    };
    svg.addEventListener("pointermove", move);
    const end = () => { if (drag < 0) return; drag = -1; loupe.hidden = true; preview(); };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);

    /* ---- live result */
    let ticket = 0;
    async function preview() {
      const my = ++ticket, p = pages[cur];
      $("wait").hidden = false;
      await new Promise((r) => setTimeout(r, 30));
      if (my !== ticket) return;
      const c = await render(p, 1100, p.canvas);
      if (my !== ticket) return;
      result.width = c.width; result.height = c.height;
      result.getContext("2d").drawImage(c, 0, 0);
      $("wait").hidden = true;
      p.thumb = c.toDataURL("image/jpeg", 0.6);
      strip();
    }
    async function thumb(i) {
      const p = pages[i];
      const c = await render(p, 260, p.canvas);
      p.thumb = c.toDataURL("image/jpeg", 0.7);
      strip();
    }

    function strip() {
      const s = $("strip");
      s.replaceChildren(...pages.map((p, i) => {
        const b = document.createElement("div");
        b.className = "scan-thumb" + (i === cur ? " on" : "");
        b.innerHTML = `${p.thumb ? `<img alt="" src="${p.thumb}">` : `<span class="ph"></span>`}<span class="n">${i + 1}</span>
          <span class="tools"><button class="mini" data-a="l" title="${t("scanMoveL")}">${icon("chevron-left", 14)}</button><button class="mini" data-a="x" title="${t("scanRemove")}">${icon("trash-2", 14)}</button><button class="mini" data-a="r" title="${t("scanMoveR")}">${icon("chevron-right", 14)}</button></span>`;
        b.onclick = (e) => {
          const a = e.target.closest("[data-a]")?.dataset.a;
          if (a === "x") { pages.splice(i, 1); if (!pages.length) return close(null); cur = Math.min(cur, pages.length - 1); return show(); }
          if (a === "l" && i > 0) { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; cur = i - 1; return show(); }
          if (a === "r" && i < pages.length - 1) { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; cur = i + 1; return show(); }
          if (i !== cur) { cur = i; show(); }
        };
        return b;
      }), ...(single ? [] : [Object.assign(document.createElement("button"), {
        className: "scan-add", innerHTML: `${icon("plus", 22)}<span>${t("scanAddPhotos")}</span>`,
        onclick: async () => { const list = await more(); if (list?.length) await add(list); },
      })]));
    }

    function show() {
      const p = pages[cur];
      $("count").textContent = t("scanCount", { i: cur + 1, n: pages.length });
      for (const b of $("modes").children) b.classList.toggle("on", b.dataset.m === p.mode);
      $("paper").value = p.paper;
      $("done").querySelector("span").textContent = single ? t("scanInsert") : t("scanCreate") + (pages.length > 1 ? ` (${pages.length})` : "");
      drawPhoto(); strip(); preview();
    }

    $("modes").onclick = (e) => { const m = e.target.closest("[data-m]")?.dataset.m; if (m) { pages[cur].mode = m; show(); } };
    $("rotl").onclick = () => { pages[cur].rot = (pages[cur].rot + 3) % 4; preview(); };
    $("rotr").onclick = () => { pages[cur].rot = (pages[cur].rot + 1) % 4; preview(); };
    $("detect").onclick = () => { pages[cur].quad = detect(pages[cur].canvas); drawQuad(); preview(); };
    $("full").onclick = () => { pages[cur].quad = [[0, 0], [1, 0], [1, 1], [0, 1]]; drawQuad(); preview(); };
    $("paper").onchange = (e) => { paper = pages[cur].paper = e.target.value; preview(); };
    $("all").onclick = () => { const p = pages[cur]; for (const q of pages) { q.mode = p.mode; q.paper = p.paper; } pages.forEach((_, i) => i !== cur && thumb(i)); toast(t("scanAppliedAll")); };
    $("cancel").onclick = () => close(null);
    $("done").onclick = async () => {
      root.classList.add("busy");
      $("done").disabled = true;
      try {
        const out = [];
        for (const p of pages) {
          // full quality for the final page
          const src = await decode(p.file, WORK);
          const c = await render(p, A4[1], src);
          const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", p.mode === "original" ? 0.88 : 0.85));
          out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
          src.width = src.height = 0;
        }
        close(out);
      } catch (e) { root.classList.remove("busy"); $("done").disabled = false; toast(String(e?.message || e), 6000); }
    };
    const ro = new ResizeObserver(() => pages.length && drawPhoto());
    ro.observe(stage);
    add(files);
  });
}
