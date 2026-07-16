/**
 * build-player-shims.mjs
 *
 * Reads data/search-index.json and generates a static HTML shim for every
 * audio shiur that has a usable audio filename. Each shim lives at:
 *
 *   player/{fileBase}.html
 *
 * and contains:
 *   - Open Graph meta tags (for WhatsApp / social previews)
 *   - An instant redirect to /player.html?file={fileBase}
 *
 * Run manually:   node scripts/build-player-shims.mjs
 * Or via GitHub Actions after search-index.json is updated.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INDEX_PATH = path.join(ROOT, "data", "search-index.json");
const OUT_DIR = path.join(ROOT, "player");

const AUDIO_TYPES = new Set(["audio", "audio-extra", "parsha-audio", "parsha"]);
const SITE_BASE = "https://torahmoment.com";
const OG_IMAGE = `${SITE_BASE}/images/og-default.png`;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFileBaseFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() || "";
    const base = filename.replace(/\.[^.]+$/i, "").trim();
    return base || "";
  } catch {
    return "";
  }
}

function buildShim({ fileBase, title, program }) {
  const safeFileBase = encodeURIComponent(fileBase);
  const ogTitle = escapeHtml(`${title} — TorahMoment`);
  const ogDesc = escapeHtml(`A ${program || "Torah"} shiur by Shloimy Zelcer`);
  const ogUrl = `${SITE_BASE}/player/${safeFileBase}`;
  const redirect = `/player.html?file=${safeFileBase}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${ogTitle}</title>
  <meta name="description" content="${ogDesc}" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta property="og:url" content="${ogUrl}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta http-equiv="refresh" content="0;url=${redirect}" />
  <script>location.replace(${JSON.stringify(redirect)});</script>
</head>
<body></body>
</html>`;
}

// --- main ---

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

const seen = new Set();
const items = [];

for (const item of index) {
  if (!AUDIO_TYPES.has(item.type)) continue;
  if (!item.url) continue;

  const fileBase = getFileBaseFromUrl(item.url);
  if (!fileBase) continue;

  // Avoid collisions if the same file base appears more than once
  if (seen.has(fileBase.toLowerCase())) continue;
  seen.add(fileBase.toLowerCase());

  items.push({
    ...item,
    fileBase,
  });
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

let created = 0;
let updated = 0;
let unchanged = 0;

for (const item of items) {
  const filePath = path.join(OUT_DIR, `${item.fileBase}.html`);
  const content = buildShim(item);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) {
      unchanged++;
      continue;
    }
    fs.writeFileSync(filePath, content, "utf8");
    updated++;
  } else {
    fs.writeFileSync(filePath, content, "utf8");
    created++;
  }
}

console.log(
  `Player shims: ${created} created, ${updated} updated, ${unchanged} unchanged (${items.length} total)`
);
