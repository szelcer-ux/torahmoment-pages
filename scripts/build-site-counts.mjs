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

async function waitForReadyFlag(page) {
  // ✅ Wait for per-page ready flags (best-effort)
  // Note: halacha.html does NOT have this yet, so we skip waiting for it.
  try {
    await page.waitForFunction(() => {
      const p = location.pathname.toLowerCase();

      if (p.includes("parsha")) {
        return window.__COUNTS_READY__?.parsha === true;
      }
      if (p.includes("tefilah")) {
        return window.__COUNTS_READY__?.tefila === true;
      }
      // halacha: don't block
      if (p.includes("one-minute")) {
        return window.__COUNTS_READY__?.oneMinute === true;
      }

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
    halacha: { totalAll: null },  // ✅ now halacha is totalAll-based
    oneMinute: { audio: null },
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
        halachaDomTotal: document.querySelector("#halachaTotalAll")?.getAttribute("data-total") ?? null,
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

  // ✅ Total now uses halacha.totalAll (since that’s what you care about)
  const total =
    safeNum(breakdown.parsha.audio) + safeNum(breakdown.parsha.video) +
    safeNum(breakdown.tefila.video) +
    safeNum(breakdown.halacha.totalAll) +
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
