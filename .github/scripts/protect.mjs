// Builds the protected app into dist/: copies src/, bundles Flipleaf's own modules into one file,
// minifies it, obfuscates it and blocks the developer tools. Open-source libraries in vendor/ are
// copied unchanged (their licenses require it). Usage: node .github/scripts/protect.mjs [--dev]
import { build, transform } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "src", OUT = "dist";
const dev = process.argv.includes("--dev");
// the desktop app has no developer tools in release builds, so it skips the debugger trap
const desktop = process.argv.includes("--desktop");
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });
if (dev) { console.log("dist/: plain copy (dev)"); process.exit(0); }

// Stops casual inspection: developer-tools shortcuts, "view source" and the browser's right-click menu
// (right-click still works in text fields, so copy/paste stays available).
const GUARD = `
const __editable = (t) => t && t.closest && t.closest("input, textarea, [contenteditable=''], [contenteditable='true']");
addEventListener("keydown", (e) => {
  const k = (e.key || "").toUpperCase(), c = e.ctrlKey || e.metaKey;
  if (k === "F12" || (c && (e.shiftKey || e.altKey) && ["I", "J", "C", "K"].includes(k)) || (c && k === "U") || (e.metaKey && e.altKey && k === "U")) {
    e.preventDefault(); e.stopImmediatePropagation();
  }
}, true);
addEventListener("contextmenu", (e) => { if (!__editable(e.target) && !e.defaultPrevented) e.preventDefault(); });
`;

const bundled = await build({
  entryPoints: [join(SRC, "app.js")], bundle: true, format: "esm", write: false, minify: true,
  target: "es2022", legalComments: "inline", external: ["./vendor/*"], charset: "utf8",
  banner: { js: GUARD },
});
const code = bundled.outputFiles[0].text;

const obf = JavaScriptObfuscator.obfuscate(code, {
  target: "browser", sourceType: "module", compact: true, seed: 7,
  identifierNamesGenerator: "hexadecimal", renameGlobals: true,
  stringArray: true, stringArrayThreshold: 1, stringArrayEncoding: ["base64"], stringArrayRotate: true,
  stringArrayShuffle: true, stringArrayIndexShift: true, stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function", splitStrings: true, splitStringsChunkLength: 8,
  controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.25,
  deadCodeInjection: true, deadCodeInjectionThreshold: 0.1,
  numbersToExpressions: true, transformObjectKeys: false, unicodeEscapeSequence: false,
  selfDefending: true, debugProtection: !desktop, debugProtectionInterval: desktop ? 0 : 3000,
  disableConsoleOutput: true, sourceMap: false,
}).getObfuscatedCode();
writeFileSync(join(OUT, "app.js"), obf);

// the other own modules are now inside app.js; only the service worker stays separate
const own = readdirSync(SRC).filter((f) => f.endsWith(".js") && !["app.js", "sw.js"].includes(f));
for (const f of own) rmSync(join(OUT, f));
let sw = readFileSync(join(SRC, "sw.js"), "utf8");
for (const f of own) sw = sw.replace(new RegExp(`\\s*"${f.replace(".", "\\.")}",`), "");
writeFileSync(join(OUT, "sw.js"), (await transform(sw, { minify: true, legalComments: "none" })).code);
writeFileSync(join(OUT, "style.css"), (await transform(readFileSync(join(SRC, "style.css"), "utf8"), { loader: "css", minify: true, legalComments: "none" })).code);
writeFileSync(join(OUT, "index.html"), readFileSync(join(SRC, "index.html"), "utf8").replace(/\n\s*/g, "\n").replace(/<!--[\s\S]*?-->/g, ""));
console.log(`dist/: protected ${desktop ? "desktop" : "web"} build (${(obf.length / 1024).toFixed(0)} KB app.js)`);
