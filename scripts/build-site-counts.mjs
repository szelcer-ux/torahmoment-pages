import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

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
        const path = urlPath === "/" ? "/index.html" : urlPath;

        const { readFile } = await import("node:fs/promises");
        const { extname } = await import("node:path");

        const file = await readFile("." + path);

        const ext = extname(path).toLowerCase();
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
  return typeof x === "number" ? x : 0;
}

async function waitForReadyFlag(page) {
  // ✅ Wait for per-page ready flags (don’t hang forever)
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

      // unknown page – don’t block
      return true;
    }, { timeout: 20000 });
  } catch {
    // Page may not be wired yet; proceed with whatever is present
  }
}

(async function main() {
  const server = await startServer();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Collect breakdown values from pages that set window.SITE_COUNTS
  const breakdown = {
    parsha: { audio: null, video: null },
    tefila: { video: null },
    halacha: { audio: null },
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
        parshaVideosLen: window.__PARSHAVIDEOS_LEN__ ?? null,
        breakdown: window.SITE_COUNTS?.allShiurim?.breakdown || null,
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

      if (b?.halacha && typeof b.halacha.audio === "number") {
        breakdown.halacha.audio = b.halacha.audio;
      }

      if (b?.oneMinute && typeof b.oneMinute.audio === "number") {
        breakdown.oneMinute.audio = b.oneMinute.audio;
      }

    } catch (e) {
      console.warn("Skipping", path, String(e));
    }
  }

  await browser.close();
  server.close();

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
