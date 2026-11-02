// Flipleaf plans and feature gating.
//
// Every Pro tool calls requirePro(featureId) before it runs and shows a "PRO" badge in menus.
// During the launch period all Pro features are free, so hasPro() always returns true.
//
// To make Pro paid later:
//   1. set LAUNCH_FREE = false;
//   2. implement activate(key) (e.g. verify a signed license key offline, or call a licensing API);
//   3. hasPro() then returns true only for activated installations.
// Nothing else in the app needs to change.

export const LAUNCH_FREE = true;

export const PRO_FEATURES = [
  // Edit & organize
  "organize", "combine", "split", "extract", "insertPages", "crop", "headerFooter", "watermark", "bates",
  // Convert
  "imagesToPdf", "exportImages", "exportText", "exportWord", "compress",
  // Forms & signatures
  "prepareForm",
  // Security
  "protect", "removeSecurity", "redact", "sanitize",
  // Comments & collaboration
  "notes", "commentsPanel", "stamps", "shapes", "compare",
];

const STORE_KEY = "flipleaf.license";

function stored() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}

/** Current plan: "launch" (everything free), "pro" (activated) or "free". */
export function plan() {
  if (LAUNCH_FREE) return "launch";
  return stored()?.valid ? "pro" : "free";
}

export function hasPro(feature) {
  if (!PRO_FEATURES.includes(feature)) return true;
  return plan() !== "free";
}

/** Placeholder for future paid activation. Returns true when the key is accepted. */
export async function activate(key) {
  // Intentionally not implemented while Flipleaf Pro is free.
  return false;
}
