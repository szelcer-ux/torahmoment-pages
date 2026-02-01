import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

/**
 * Count Parsha videos from YouTube playlist items by matching description text.
 */
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

const PORT = 4173;

// ✅ Filenames must match your repo
const PAGES = [
  "/parsha.html",
  "/tefilah.html",
  "/halacha.html",
  "/one-minute-audio.html",
];

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
          ext === ".html" ? "text/html; charset=utf-8" :
          ext === ".js"   ? "text/javascript; charset=utf-8" :
          ext === ".json" ? "application/json; charset=utf-8" :
          ext === ".css"  ? "text/css; charset=utf-8" :
          ext === ".png"  ? "image/png" :
          ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".svg"  ? "image/svg+xml" :
          "application/octet-stream";

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

/**
 * Wait for per-page ready flags (best-effort; won’t hang forever).
 * Your pages can set window.__COUNTS_READY__ = { halacha:true, ... }.
 */
async function waitForReadyFlag(page) {
  try {
    await page.waitForFunction(() => {
      const p = location.pathname.toLowerCase();

      if (p.includes("parsha")) {
        return window.__COUNTS_READY__?.parsha === true;
      }
      if (p.includes("tefilah")) {
        return window.__COUNTS_READY__?.tefila === true;
      }
      if (p.includes("halacha")) {
        return window.__COUNTS_READY__?.halacha === true;
      }
      if (p.includes("one-minute")) {
        return window.__COUNTS_READY__?.oneMinute === true;
      }

      return true;
    }, { timeout: 20000 });
  } catch {
    // Not wired yet or slow; proceed with whatever is present.
  }
}

/**
 * Read halacha totalAll in a robust way:
 * 1) Prefer window.SITE_COUNTS.allShiurim.breakdown.halacha.totalAll
 * 2) Fallback to window.__HALACHA_TOTALALL__
 * 3) Fallback to DOM: #halachaTotalAll[data-total]
 */
async function readHalachaTotalAll(page) {
  return await page.evaluate(() => {
    // 1) Preferred (your existing pattern)
    const v1 = window.SITE_COUNTS?.allShiurim?.breakdown?.halacha?.totalAll;
    if (typeof v1 === "number" && Number.isFinite(v1)) return v1;

    // 2) Alternate global
    const v2 = window.__HALACHA_TOTALALL__;
    if (typeof v2 === "number" && Number.isFinite(v2)) return v2;

    // 3) DOM fallback
    const el = document.querySelector("#halachaTotalAll");
    if (el) {
      const raw = el.getAttribute("data-total") || el.dataset.total;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }

    return null;
  });
}

(async function main() {
  const server = await startServer();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Collect breakdown values from pages that set window.SITE_COUNTS
  const breakdown = {
    parsha: { audio: null, video: null },
    tefila: { video: null },
    halacha: { audio: null, totalAll: null },   // ✅ added totalAll
    oneMinute: { audio: null },
  };

  for (const path of PAGES) {
    const url = `http://127.0.0.1:${PORT}${path}`;

    try {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });

      // ✅ Wait until the page says counts are ready
      await waitForReadyFlag(page);

      // ✅ Snapshot everything we care about (helps debugging in Action logs)
      const snap = await page.evaluate(() => ({
        pathname: location.pathname,
        ready: window.__COUNTS_READY__ || null,
        breakdown: window.SITE_COUNTS?.allShiurim?.breakdown || null,
      }));

      console.log("SNAP", path, JSON.stringify(snap));

      const b = snap.breakdown;

      // Existing wiring
      if (b?.parsha) {
        if (typeof b.parsha.audio === "number") breakdown.parsha.audio = b.parsha.audio;
        if (typeof b.parsha.video === "number") breakdown.parsha.video = b.parsha.video;
      }

      if (b?.tefila && typeof b.tefila.video === "number") {
        breakdown.tefila.video = b.tefila.video;
      }

      if (b?.halacha) {
        if (typeof b.halacha.audio === "number") breakdown.halacha.audio = b.halacha.audio;
        // ✅ If you choose to expose totalAll via SITE_COUNTS on the page, this picks it up automatically:
        if (typeof b.halacha.totalAll === "number") breakdown.halacha.totalAll = b.halacha.totalAll;
      }

      if (b?.oneMinute && typeof b.oneMinute.audio === "number") {
        breakdown.oneMinute.audio = b.oneMinute.audio;
      }

      // ✅ Extra: if we're on halacha.html and totalAll wasn't found above, try robust readers
      if (path.includes("halacha") && breakdown.halacha.totalAll == null) {
        const totalAll = await readHalachaTotalAll(page);
        if (typeof totalAll === "number") breakdown.halacha.totalAll = totalAll;
        console.log("HALACHA totalAll:", breakdown.halacha.totalAll);
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

  await browser.close();
  server.close();

  // ✅ Total: keep your original “allShiurim total” calculation unchanged
  // If you want halacha.totalAll to REPLACE halacha.audio in the total, tell me and I’ll adjust.
  const total =
    safeNum(breakdown.parsha.audio) + safeNum(breakdown.parsha.video) +
    safeNum(breakdown.tefila.video) +
    safeNum(breakdown.halacha.audio) +
    safeNum(breakdown.oneMinute.audio);

  const out = {
    allShiurim: {
      total,
      breakdown,
      updated: new Date().toISOString().slice(0, 10),
    },
  };

  writeFileSync("./data/site-counts.json", JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log("Wrote data/site-counts.json:", out.allShiurim);
})();
