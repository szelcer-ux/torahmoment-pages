import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

/* -------------------------------------------------------
   CONFIG
------------------------------------------------------- */

const PORT = 4173;

const PAGES = [
  "/parsha.html",
  "/halacha.html",
  "/one-minute-audio.html",
  "/tefilah.html",
  "/mishna.html",
];

const PLAYLIST_ID = "UUzx1pweEHKhsIfPkQZbRH4w";
 
/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function parseMmDdYyyy(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/* -------------------------------------------------------
   STATIC SERVER
------------------------------------------------------- */

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        const filePath = urlPath === "/" ? "/index.html" : urlPath;

        const { readFile } = await import("node:fs/promises");
        const { extname } = await import("node:path");

        const file = await readFile("." + filePath);
        const ext = extname(filePath).toLowerCase();

        const ct =
          ext === ".html" ? "text/html; charset=utf-8" :
          ext === ".js"   ? "text/javascript; charset=utf-8" :
          ext === ".json" ? "application/json; charset=utf-8" :
          ext === ".css"  ? "text/css; charset=utf-8" :
          "application/octet-stream";

        res.writeHead(200, { "Content-Type": ct });
        res.end(file);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(PORT, () => resolve(server));
  });
}

/* -------------------------------------------------------
   YOUTUBE (SERVER ONLY)
------------------------------------------------------- */

async function getAllParshaVideos(apiKey) {
  let pageToken = "";
  const out = [];

  while (true) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet&playlistId=${PLAYLIST_ID}&maxResults=50` +
      `&pageToken=${pageToken}&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();

    for (const it of data.items || []) {
      const sn = it.snippet || {};
      const vid = sn.resourceId?.videoId;
      if (!vid) continue;

      out.push({
        id: `par-${vid}`,
        program: "Parsha",
        type: "video",
        title: sn.title || "Parsha Shiur",
        date: sn.publishedAt || null,
        url: `https://www.youtube.com/watch?v=${vid}`,
        page: "/parsha.html",
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return out;
}

/* -------------------------------------------------------
   HALACHA FLATTEN
------------------------------------------------------- */

function flattenHalacha(data) {
  const out = [];
  for (const cat of data || []) {
    for (const sub of cat.subcategories || []) {
      for (const it of sub.items || []) {
        const date = parseMmDdYyyy(it.note);
        if (!date) continue;

        out.push({
          id: `hal-${out.length}`,
          program: "Halacha",
          type: "audio",
          title: it.title,
          date,
          url: it.url,
          page: "/halacha.html",
        });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------
   MAIN
------------------------------------------------------- */

(async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  /* -----------------------------
     COUNTS
  ----------------------------- */

  const breakdown = {
    parsha: { audio: 0, video: 0 },
    halacha: { totalAll: 0 },
    oneMinute: { audio: 0 },
    tefila: { video: 0 },
    mishna: { audio: 0 },
  };

  for (const path of PAGES) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "load" });
      const snap = await page.evaluate(() => ({
        counts: window.SITE_COUNTS?.allShiurim?.breakdown || null,
        halachaDom: document.querySelector("#halachaTotalAll")?.dataset?.total || null,
        mishna: window.TM_COUNTS?.total_items || null,
      }));

      if (snap.counts?.parsha) {
        breakdown.parsha.audio = safeNum(snap.counts.parsha.audio);
        breakdown.parsha.video = safeNum(snap.counts.parsha.video);
      }
      if (snap.counts?.oneMinute) breakdown.oneMinute.audio = safeNum(snap.counts.oneMinute.audio);
      if (snap.counts?.tefila) breakdown.tefila.video = safeNum(snap.counts.tefila.video);
      if (snap.halachaDom) breakdown.halacha.totalAll = Number(snap.halachaDom);
      if (snap.mishna) breakdown.mishna.audio = Number(snap.mishna);
    } catch {}
  }

  if (!breakdown.parsha.video) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      const vids = await getAllParshaVideos(apiKey);
      breakdown.parsha.video = vids.length;
    }
  }

  const total =
    safeNum(breakdown.parsha.audio) +
    safeNum(breakdown.parsha.video) +
    safeNum(breakdown.halacha.totalAll) +
    safeNum(breakdown.oneMinute.audio) +
    safeNum(breakdown.tefila.video) +
    safeNum(breakdown.mishna.audio);

  /* -----------------------------
     SEARCH INDEX
  ----------------------------- */

  let allItems = [];

  // One-Minute
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/data.json`);
    const arr = await res.json();
    for (const x of arr || []) {
      allItems.push({
        id: `one-${x.id}`,
        program: "One-Minute",
        type: "audio",
        title: x.description || "One-Minute Audio",
        date: parseMmDdYyyy(x.date),
        url: x.url,
        page: "/one-minute-audio.html",
      });
    }
  } catch {}

  // Halacha
  try {
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`, { waitUntil: "load" });
    const data = await page.evaluate(() => window.HALACHA_DATA || window.PAGE_DATA || []);
    allItems.push(...flattenHalacha(data));
  } catch {}

  // Parsha
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) allItems.push(...await getAllParshaVideos(apiKey));
  } catch {}

  const searchIndex = allItems
    .filter(x => x.title && x.url)
    .map(x => ({ ...x, title_lc: norm(x.title) }));

  /* -----------------------------
     WRITE FILES
  ----------------------------- */

  writeFileSync(
    "./data/site-counts.json",
    JSON.stringify({
      allShiurim: {
        total,
        breakdown,
        updated: new Date().toISOString().slice(0, 10),
      },
    }, null, 2)
  );

  writeFileSync(
    "./data/search-index.json",
    JSON.stringify(searchIndex, null, 2)
  );

  console.log("✔ site-counts.json + search-index.json written");

  await browser.close();
  server.close();
})();
