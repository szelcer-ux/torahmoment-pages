import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

const PORT = 4173;

// Pages to probe. Adjust filenames to match your repo.
const PAGES = [
  "/parsha.html",
  "/tefila.html",
  "/halacha.html",
  "/one-minute-audio.html",
];

// Simple static file server for the repo root
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        // Map URL to filesystem path
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        const path = urlPath === "/" ? "/index.html" : urlPath;

        // Dynamic import of fs/promises only when needed
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

    // ✅ Wait a bit for inline JS / setTimeout / async init to populate SITE_COUNTS
    // Don't fail the whole run if a page isn't wired yet.
    try {
      await page.waitForFunction(() => {
        const b = window.SITE_COUNTS?.allShiurim?.breakdown;
        if (!b) return false;

        // If this page is the Parsha page, wait until BOTH audio+video are numbers
        if (b.parsha) {
          return (typeof b.parsha.audio === "number" && typeof b.parsha.video === "number");
        }

        // Otherwise, accept any page that has at least one numeric count
        if (b.tefila && typeof b.tefila.video === "number") return true;
        if (b.halacha && typeof b.halacha.audio === "number") return true;
        if (b.oneMinute && typeof b.oneMinute.audio === "number") return true;

        return false;
      }, { timeout: 15000 });
    } catch {
      // ok — page might not be wired yet; we'll read whatever is present
    }

    const b = await page.evaluate(() => {
      return window.SITE_COUNTS?.allShiurim?.breakdown || null;
    });

    if (b?.parsha) {
      if (typeof b.parsha.audio === "number") breakdown.parsha.audio = b.parsha.audio;
      if (typeof b.parsha.video === "number") breakdown.parsha.video = b.parsha.video;
    }
    if (b?.tefila && typeof b.tefila.video === "number") breakdown.tefila.video = b.tefila.video;
    if (b?.halacha && typeof b.halacha.audio === "number") breakdown.halacha.audio = b.halacha.audio;
    if (b?.oneMinute && typeof b.oneMinute.audio === "number") breakdown.oneMinute.audio = b.oneMinute.audio;

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
