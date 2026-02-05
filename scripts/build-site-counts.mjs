import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

async function countParshaVideosFromYouTube(apiKey) {
  const PLAYLIST_ID = "UUzx1pweEHKhsIfPkQZbRH4w";
  const SEARCH = "dvar torah parshas";

  let count = 0;
  let pageToken = "";

  while (true) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet` +
      `&playlistId=${PLAYLIST_ID}` +
      `&maxResults=50` +
      `&pageToken=${pageToken}` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube API error ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();

    for (const item of data.items || []) {
      const desc = (item.snippet?.description || "").toLowerCase();
      if (desc.includes(SEARCH)) count++;
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return count;
}

// ✅ Recent Parsha list (for homepage/dashboard "recent")
async function getRecentParshaVideosFromYouTube(apiKey, limit = 10) {
  const PLAYLIST_ID = "UUzx1pweEHKhsIfPkQZbRH4w";
  const SEARCH = "dvar torah parshas";

  const out = [];
  let pageToken = "";

  while (out.length < limit) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet,contentDetails` +
      `&playlistId=${PLAYLIST_ID}` +
      `&maxResults=50` +
      `&pageToken=${pageToken}` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) break;

    const data = await res.json();

    for (const item of data.items || []) {
      const sn = item.snippet || {};
      const desc = (sn.description || "").toLowerCase();
      if (!desc.includes(SEARCH)) continue;

      const videoId = item.contentDetails?.videoId;
      const publishedAt = sn.publishedAt;
      if (!videoId || !publishedAt) continue;

      out.push({
        type: "video",
        program: "Parsha",
        title: sn.title || "Parsha video",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        date: publishedAt,
      });

      if (out.length >= limit) break;
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return out;
}

const PORT = 4173;

// ✅ Filenames must match your repo
const PAGES = [
  "/parsha.html",
  "/tefilah.html",
  "/halacha.html",
  "/one-minute-audio.html",
  "/mishna.html",
];

function parseMmDdYyyy(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]), yyyy = Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sortByDateDesc(arr) {
  return (arr || [])
    .filter((x) => x && x.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function flattenHalacha(data) {
  const out = [];
  for (const cat of data || []) {
    for (const sub of cat.subcategories || []) {
      for (const it of sub.items || []) {
        const date = parseMmDdYyyy(it.note);
        if (!date) continue;

        out.push({
          type: "audio",
          program: "Halacha",
          title: it.title || "Halacha",
          url: it.url,
          date,
        });
      }
    }
  }
  return out.filter((x) => x.url && x.date);
}

// Simple static file server for the repo root
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
        const contentType =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : ext === ".json"
            ? "application/json; charset=utf-8"
            : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".svg"
            ? "image/svg+xml"
            : "application/octet-stream";

        res.writeHead(200, { "Content-Type": contentType });
        res.end(file);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(PORT, () => resolve(server));
  });
}

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

async function waitForReadyFlag(page) {
  // ✅ Wait for per-page ready flags (best-effort)
  // Note: halacha.html does NOT have this yet, so we skip waiting for it.
  try {
    await page.waitForFunction(() => {
      const p = location.pathname.toLowerCase();

      if (p.includes("parsha")) return window.__COUNTS_READY__?.parsha === true;
      if (p.includes("tefilah")) return window.__COUNTS_READY__?.tefila === true;
      // halacha: don't block
      if (p.includes("one-minute")) return window.__COUNTS_READY__?.oneMinute === true;

      return true;
    }, { timeout: 20000 });
  } catch {
    // proceed
  }
}

async function readHalachaTotalAllFromDom(page) {
  // Wait for it to exist in the DOM (it is hidden, so don't wait for "visible")
  await page.waitForSelector("#halachaTotalAll[data-total]", {
    timeout: 20000,
    state: "attached",
  });

  const n = await page.locator("#halachaTotalAll").evaluate((el) => {
    const raw = el.getAttribute("data-total") || el.dataset.total || "0";
    return Number(raw);
  });

  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid halacha totalAll from DOM: ${n}`);
  }

  return n;
}

(async function main() {
  const server = await startServer();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Collect breakdown values
  const breakdown = {
    parsha: { audio: null, video: null },
    tefila: { video: null },
    halacha: { totalAll: null },
    oneMinute: { audio: null },
    mishna: { audio: null }, // ✅ new
  };

  for (const path of PAGES) {
    const url = `http://127.0.0.1:${PORT}${path}`;

    try {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });

      // ✅ Wait until the page says counts are ready (except halacha)
      await waitForReadyFlag(page);

      // ✅ Debug snapshot
      const snap = await page.evaluate(() => ({
        pathname: location.pathname,
        ready: window.__COUNTS_READY__ || null,
        breakdown: window.SITE_COUNTS?.allShiurim?.breakdown || null,
        halachaDomTotal:
          document.querySelector("#halachaTotalAll")?.getAttribute("data-total") ?? null,
        tmCounts: window.TM_COUNTS || null, // ✅ mishna exports this
      }));

      console.log("SNAP", path, JSON.stringify(snap));

      const b = snap.breakdown;

      if (b?.parsha) {
        if (typeof b.parsha.audio === "number") breakdown.parsha.audio = b.parsha.audio;
        if (typeof b.parsha.video === "number") breakdown.parsha.video = b.parsha.video;
      }

      if (b?.tefila && typeof b.tefila.video === "number") {
        breakdown.tefila.video = b.tefila.video;
      }

      if (b?.oneMinute && typeof b.oneMinute.audio === "number") {
        breakdown.oneMinute.audio = b.oneMinute.audio;
      }

      // ✅ Halacha: read from DOM export
      if (path.includes("halacha")) {
        breakdown.halacha.totalAll = await readHalachaTotalAllFromDom(page);
        console.log("HALACHA totalAll:", breakdown.halacha.totalAll);
      }

      // ✅ Mishna: read from window.TM_COUNTS
      if (path.includes("mishna")) {
        const n = Number(snap.tmCounts?.total_items ?? 0);

        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Invalid mishna total_items: ${snap.tmCounts?.total_items}`);
        }

        breakdown.mishna.audio = n;

        console.log("MISHNA audio:", breakdown.mishna.audio);
      }
    } catch (e) {
      console.warn("Skipping", path, String(e));
    }
  }

  // 🔒 Authoritative Parsha video count from YouTube API
  if (!safeNum(breakdown.parsha.video)) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY secret");

    const ytCount = await countParshaVideosFromYouTube(apiKey);
    breakdown.parsha.video = ytCount;

    console.log("YouTube Parsha video count:", ytCount);
  }

  // ---- BUILD RECENT LIST ----
  let recentHalacha = [];
  let recentOneMin = [];
  let recentParsha = [];

  try {
    // Halacha (from PAGE_DATA)
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`, { waitUntil: "load" });
    const halachaData = await page.evaluate(() => window.HALACHA_DATA);
    recentHalacha = flattenHalacha(halachaData);
  } catch (e) {
    console.warn("Recent Halacha failed:", String(e));
  }

  try {
    // One-Minute JSON (this is DATA_URL = "./data.json" on one-minute-audio.html)
    const res = await fetch(`http://127.0.0.1:${PORT}/data.json`);
    const oneMin = await res.json();
    const items = Array.isArray(oneMin) ? oneMin : (oneMin.items || []);

    recentOneMin = items
      .map((x) => ({
        type: "audio",
        program: "One-Minute",
        title: x.description || x.filename || "One-Minute Audio",
        url: x.url,
        date: parseMmDdYyyy(x.date),
      }))
      .filter((x) => x.url && x.date);
  } catch (e) {
    console.warn("Recent One-Minute failed:", String(e));
  }

  try {
    // Parsha videos (server-side only)
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (apiKey) {
      recentParsha = await getRecentParshaVideosFromYouTube(apiKey, 10);
    }
  } catch (e) {
    console.warn("Recent Parsha failed:", String(e));
  }

  // ✅ Ensure each bucket is newest → oldest BEFORE slicing
  recentHalacha = sortByDateDesc(recentHalacha);
  recentOneMin  = sortByDateDesc(recentOneMin);
  recentParsha  = sortByDateDesc(recentParsha);

  // Flat top-5 overall (still useful)
  const recent = sortByDateDesc([
    ...recentHalacha,
    ...recentOneMin,
    ...recentParsha,
  ]).slice(0, 5);

  await browser.close();
  server.close();

  // ✅ Total now includes mishna
  const total =
    safeNum(breakdown.parsha.audio) +
    safeNum(breakdown.parsha.video) +
    safeNum(breakdown.tefila.video) +
    safeNum(breakdown.halacha.totalAll) +
    safeNum(breakdown.oneMinute.audio) +
    safeNum(breakdown.mishna.audio);

  const out = {
    allShiurim: {
      total,
      breakdown,
      updated: new Date().toISOString().slice(0, 10),
    },

    // top-5 overall
    recent,

    // per-program (sorted correctly) for curated displays
    recentByProgram: {
      oneMinute: recentOneMin.slice(0, 10),
      halacha: recentHalacha.slice(0, 10),
      parsha: recentParsha.slice(0, 10),
    },
  };

  writeFileSync("./data/site-counts.json", JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Wrote data/site-counts.json:", out.allShiurim);
})();
