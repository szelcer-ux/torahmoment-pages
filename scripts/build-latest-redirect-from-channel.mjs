import fs from "fs";

const CHANNEL_ID = process.env.CHANNEL_ID;
if (!CHANNEL_ID) {
  console.error("Missing CHANNEL_ID env var");
  process.exit(1);
}

const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(CHANNEL_ID)}`;

const res = await fetch(FEED_URL, { headers: { "user-agent": "torahmoment-bot" } });
if (!res.ok) {
  console.error("Failed to fetch feed:", res.status, res.statusText);
  process.exit(1);
}

const xml = await res.text();

// First <entry> = newest upload
const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
if (!entryMatch) {
  console.error("No <entry> found in feed.");
  process.exit(1);
}
const entry = entryMatch[1];

const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);

if (!idMatch) {
  console.error("No yt:videoId found in first entry.");
  process.exit(1);
}

const videoId = idMatch[1].trim();
let title = (titleMatch ? titleMatch[1] : "TorahMoment — Latest").trim();

// safe escape for meta tags
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// Redirect target
const youtubeUrl = `https://youtu.be/${videoId}`;

// Thumbnail (hqdefault is reliable)
const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// Important: this is the URL people share
const canonical = "https://torahmoment.com/latest";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>

  <!-- WhatsApp / link previews -->
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="This week’s Dvar Torah from TorahMoment." />
  <meta property="og:image" content="${thumb}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:type" content="website" />

  <!-- Extra preview helpers -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:image" content="${thumb}" />

  <link rel="canonical" href="${canonical}" />

  <!-- Instant redirect -->
  <meta http-equiv="refresh" content="0; url=${youtubeUrl}" />

  <script>
    // JS redirect as backup
    window.location.replace(${JSON.stringify(youtubeUrl)});
  </script>
</head>
<body>
  Redirecting to the latest TorahMoment video…
  <a href="${youtubeUrl}">Click here if you’re not redirected</a>.
</body>
</html>
`;

fs.mkdirSync("latest", { recursive: true });
fs.writeFileSync("latest/index.html", html);

console.log("Built latest redirect page to:", youtubeUrl);
