import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

/* =========================================================
   YOUTUBE HELPERS (Parsha)
========================================================= */

const YT_PLAYLIST_ID = "UUzx1pweEHKhsIfPkQZbRH4w"; // uploads playlist
const YT_SEARCH = "dvar torah parshas";

// Fetch ALL matching Parsha videos (filtered by description),
// and also return a "recent" list (newest first) without extra API calls.
async function getAllAndRecentParshaVideosFromYouTube(apiKey, recentLimit = 10) {
  const all = [];
  const recent = [];
  let pageToken = "";

  while (true) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet,contentDetails` +
      `&playlistId=${YT_PLAYLIST_ID}` +
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
      const sn = item.snippet || {};
      const desc = (sn.description || "").toLowerCase();
      if (!desc.includes(YT_SEARCH)) continue;

      const videoId = item.contentDetails?.videoId || sn.resourceId?.videoId;
      const publishedAt = sn.publishedAt;
      if (!videoId || !publishedAt) continue;

      const obj = {
        type: "video",
        program: "Parsha",
        title: sn.title || "Parsha video",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        date: publishedAt,
      };

      all.push(obj);

      // uploads playlist is newest-first, so the first matching ones are your "recent"
      if (recent.length < recentLimit) recent.push(obj);
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return { all, recent };
}

// Back-compat: count only
async function countParshaVideosFromYouTube(apiKey) {
  const { all } = await getAllAndRecentParshaVideosFromYouTube(apiKey, 0);
  return all.length;
}

/* =========================================================
   CONFIG
========================================================= */

const PORT = 4173;

// ✅ Filenames must match your repo
const PAGES = [
  "/parsha.html",
  "/tefilah.html",
  "/halacha.html",
  "/one-minute-audio.html",
  "/mishna.html",
];

/* =========================================================
   DATE + LIST HELPERS
========================================================= */

function parseMmDdYyyy(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return null;
  const mm = Number(m[1]),
    dd = Number(m[2]),
    yyyy = Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sortByDateDesc(arr) {
  return (arr || [])
    .filter((x) => x && x.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function safeNum(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

/* =========================================================
   HALACHA FLATTEN (for recent + search-index)
========================================================= */

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

/* =========================================================
   STATIC SERVER (repo root)
========================================================= */

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

/* =========================================================
   PAGE READY + DOM READERS
========================================================= */

async function waitForReadyFlag(page) {
  // Best-effort per-page ready flags
  try {
    await page.waitForFunction(
      () => {
        const p = location.pathname.toLowerCase();
        if (p.includes("parsha")) return window.__COUNTS_READY__?.parsha === true;
        if (p.includes("tefilah")) return window.__COUNTS_READY__?.tefila === true;
        if (p.includes("one-minute")) return window.__COUNTS_READY__?.oneMinute === true;
        // halacha: don't block
        return true;
      },
      { timeout: 20000 }
    );
  } catch {
    // proceed
  }
}

async function readHalachaTotalAllFromDom(page) {
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

/* =========================================================
   MAIN
========================================================= */

(async function main() {
  const server = await startServer();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // ---------------------------
  // 1) Read One-Minute JSON ONCE (authoritative for count + recent + search-index)
  // ---------------------------
  let oneMinItems = [];
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/data.json`);
    const oneMin = await res.json();
    oneMinItems = Array.isArray(oneMin) ? oneMin : oneMin.items || [];
  } catch (e) {
    console.warn("One-Minute data.json failed:", String(e));
    oneMinItems = [];
  }

  // ---------------------------
  // 2) Collect breakdown values (same as your working approach)
  // ---------------------------
  const breakdown = {
    parsha: { audio: null, video: null },
    tefila: { video: null },
    halacha: { totalAll: null },
    oneMinute: { audio: null },
    mishna: { audio: null },
  };

  for (const path of PAGES) {
    const url = `http://127.0.0.1:${PORT}${path}`;

    try {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await waitForReadyFlag(page);

      const snap = await page.evaluate(() => ({
        pathname: location.pathname,
        ready: window.__COUNTS_READY__ || null,
        breakdown: window.SITE_COUNTS?.allShiurim?.breakdown || null,
        halachaDomTotal:
          document.querySelector("#halachaTotalAll")?.getAttribute("data-total") ?? null,
        tmCounts: window.TM_COUNTS || null,
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

      // IMPORTANT: one-minute page counts can be flaky; we override later from data.json
      if (b?.oneMinute && typeof b.oneMinute.audio === "number") {
        breakdown.oneMinute.audio = b.oneMinute.audio;
      }

      if (path.includes("halacha")) {
        breakdown.halacha.totalAll = await readHalachaTotalAllFromDom(page);
        console.log("HALACHA totalAll:", breakdown.halacha.totalAll);
      }

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

  // Authoritative one-minute COUNT from data.json
  breakdown.oneMinute.audio = oneMinItems.length;

  // Authoritative Parsha VIDEO count from YouTube filter (keeps your original behavior)
  let allParshaVideos = [];
  let recentParsha = [];
  if (!safeNum(breakdown.parsha.video)) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY secret");

    const { all, recent } = await getAllAndRecentParshaVideosFromYouTube(apiKey, 10);
    allParshaVideos = all;
    recentParsha = recent;

    breakdown.parsha.video = allParshaVideos.length;
    console.log("YouTube Parsha video count:", breakdown.parsha.video);
  } else {
    // Still build recentParsha for homepage/dashboard if we can (optional)
    try {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (apiKey) {
        const { all, recent } = await getAllAndRecentParshaVideosFromYouTube(apiKey, 10);
        allParshaVideos = all;
        recentParsha = recent;
      }
    } catch (e) {
      console.warn("Recent Parsha failed:", String(e));
    }
  }

  // ---------------------------
  // 3) Build RECENTS (same behavior as your working script)
  // ---------------------------
  let recentHalacha = [];
  let recentOneMin = [];
  // recentParsha already filled above (or empty)

  try {
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`, { waitUntil: "load" });

   const halachaData = await page.evaluate(() => {
  if (window.HALACHA_DATA) return window.HALACHA_DATA;
  // PAGE_DATA is a const global, not on window
  if (typeof PAGE_DATA !== "undefined") return PAGE_DATA;
  return null;
});

    recentHalacha = flattenHalacha(halachaData);
  } catch (e) {
    console.warn("Recent Halacha failed:", String(e));
  }

  try {
    recentOneMin = (oneMinItems || [])
      .map((x, i) => ({
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

  // ensure newest → oldest
  recentHalacha = sortByDateDesc(recentHalacha);
  recentOneMin = sortByDateDesc(recentOneMin);
  recentParsha = sortByDateDesc(recentParsha);

  const recent = sortByDateDesc([
    ...recentHalacha,
    ...recentOneMin,
    ...recentParsha,
  ]).slice(0, 5);

  // ---------------------------
  // 4) TOTAL (unchanged logic, but now one-minute is correct)
  // ---------------------------
  const total =
    safeNum(breakdown.parsha.audio) +
    safeNum(breakdown.parsha.video) +
    safeNum(breakdown.tefila.video) +
    safeNum(breakdown.halacha.totalAll) +
    safeNum(breakdown.oneMinute.audio) +
    safeNum(breakdown.mishna.audio);

  // ---------------------------
  // 5) WRITE site-counts.json (unchanged structure)
  // ---------------------------
  const out = {
    allShiurim: {
      total,
      breakdown,
      updated: new Date().toISOString().slice(0, 10),
    },

    recent,

    recentByProgram: {
      oneMinute: recentOneMin.slice(0, 10),
      halacha: recentHalacha.slice(0, 10),
      parsha: recentParsha.slice(0, 10),
    },
  };

  writeFileSync("./data/site-counts.json", JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Wrote data/site-counts.json:", out.allShiurim);

  // ---------------------------
  // 6) WRITE search-index.json (NEW)
  //    Only includes: One-Minute, Halacha, Parsha
  // ---------------------------

  // Full Halacha list
  let allHalacha = [];
  try {
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`, { waitUntil: "load" });
    const halachaData = await page.evaluate(() => {
  if (window.HALACHA_DATA) return window.HALACHA_DATA;
  // PAGE_DATA is a const global, not on window
  if (typeof PAGE_DATA !== "undefined") return PAGE_DATA;
  return null;
});

    allHalacha = flattenHalacha(halachaData);
  } catch (e) {
    console.warn("Halacha index build failed:", String(e));
    allHalacha = [];
  }

  const indexOneMin = (oneMinItems || [])
    .map((x, i) => ({
      id: `one-${x.id ?? i}`,
      program: "One-Minute",
      type: "audio",
      title: x.description || x.filename || "One-Minute Audio",
      url: x.url,
      date: parseMmDdYyyy(x.date),
      page: "/one-minute-audio.html",
    }))
    .filter((x) => x.url && x.title);

  const indexHalacha = (allHalacha || [])
    .map((x, i) => ({
      id: `hal-${i}`,
      program: "Halacha",
      type: "audio",
      title: x.title || "Halacha",
      url: x.url,
      date: x.date,
      page: "/halacha.html",
    }))
    .filter((x) => x.url && x.title);

  const indexParsha = (allParshaVideos || [])
    .map((x) => ({
      id: `par-${x.url.split("v=")[1] || x.date || Math.random().toString(16).slice(2)}`,
      program: "Parsha",
      type: "video",
      title: x.title || "Parsha video",
      url: x.url,
      date: x.date,
      page: "/parsha.html",
    }))
    .filter((x) => x.url && x.title);

  const searchIndex = [...indexOneMin, ...indexHalacha, ...indexParsha].map((x) => ({
    ...x,
    title_lc: norm(x.title),
  }));

  writeFileSync("./data/search-index.json", JSON.stringify(searchIndex, null, 2) + "\n", "utf8");
  console.log("Wrote data/search-index.json:", searchIndex.length);

  // ---------------------------
  // 7) shutdown
  // ---------------------------
  await browser.close();
  server.close();
})();
