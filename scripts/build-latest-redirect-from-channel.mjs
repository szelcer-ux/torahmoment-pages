import fs from "fs";

const CHANNEL_ID = process.env.CHANNEL_ID;
if (!CHANNEL_ID) {
  console.error("Missing CHANNEL_ID env var");
  process.exit(1);
}

const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(CHANNEL_ID)}`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 3, delayMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "torahmoment-bot" }
      });

      if (res.ok) return res;

      console.log(`Fetch attempt ${i} failed: ${res.status} ${res.statusText}`);
    } catch (err) {
      console.log(`Fetch attempt ${i} error: ${err.message}`);
    }

    if (i < attempts) {
      await sleep(delayMs);
    }
  }

  return null;
}

const res = await fetchWithRetry(FEED_URL, 3, 5000);

if (!res) {
  console.log("Could not fetch YouTube feed. Keeping existing latest/index.html.");
  process.exit(0);
}

const xml = await res.text();

// First <entry> = newest upload
const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
if (!entryMatch) {
  console.log("No <entry> found in feed. Keeping existing latest/index.html.");
  process.exit(0);
}

const entry = entryMatch[1];
const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);

if (!idMatch) {
  console.log("No yt:videoId found in first entry. Keeping existing latest/index.html.");
  process.exit(0);
}

const videoId = idMatch[1].trim();
const title = (titleMatch ? titleMatch[1] : "TorahMoment — Latest").trim();

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const youtubeUrl = `https://youtu.be/${videoId}`;
const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
const canonical = "https://torahmoment.com/latest";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>

  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="This week’s Dvar Torah from TorahMoment." />
  <meta property="og:image" content="${thumb}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:type" content="website" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:image" content="${thumb}" />

  <link rel="canonical" href="${canonical}" />
  <meta http-equiv="refresh" content="0; url=${youtubeUrl}" />

  <script>
    window.location.replace(${JSON.stringify(youtubeUrl)});
  </script>
</head>
<body>
  Redirecting to the latest TorahMoment video…
  <a href="${youtubeUrl}">Click here if you’re not redirected</a>.
</body>
</html>`;

fs.mkdirSync("latest", { recursive: true });
fs.writeFileSync("latest/index.html", html);

console.log("Built latest redirect page to:", youtubeUrl);
