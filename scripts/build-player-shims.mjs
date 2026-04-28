/**
 * build-player-shims.mjs
 *
 * Reads data/search-index.json and generates a static HTML shim for every
 * audio shiur that has an id. Each shim lives at player/{id}.html and contains:
 *   - Open Graph meta tags (for WhatsApp / social previews)
 *   - An instant redirect to /player.html?id={id}
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
const OUT_DIR    = path.join(ROOT, "player");

const AUDIO_TYPES = new Set(["audio", "audio-extra", "parsha-audio"]);
const SITE_BASE   = "https://torahmoment.com";
const OG_IMAGE    = `${SITE_BASE}/images/og-default.png`;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildShim({ id, title, program }) {
  const ogTitle  = escapeHtml(`${title} — TorahMoment`);
  const ogDesc   = escapeHtml(`A ${program} shiur by Shloimy Zelcer`);
  const ogUrl    = `${SITE_BASE}/player/${id}`;
  const redirect = `/player.html?id=${encodeURIComponent(id)}`;

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
  <script>location.replace('${redirect}');</script>
</head>
<body></body>
</html>`;
}

// --- main ---

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const items = index.filter(x => x.id && AUDIO_TYPES.has(x.type));

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

let created = 0;
let updated = 0;
let unchanged = 0;

for (const item of items) {
  const filePath = path.join(OUT_DIR, `${item.id}.html`);
  const content  = buildShim(item);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) { unchanged++; continue; }
    fs.writeFileSync(filePath, content, "utf8");
    updated++;
  } else {
    fs.writeFileSync(filePath, content, "utf8");
    created++;
  }
}

console.log(`Player shims: ${created} created, ${updated} updated, ${unchanged} unchanged (${items.length} total)`);
