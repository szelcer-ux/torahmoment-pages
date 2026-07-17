import { writeFileSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright";

const YT_PLAYLIST_ID = "UUzx1pweEHKhsIfPkQZbRH4w";
const YT_SEARCH = "dvar torah parshas";

async function getAllAndRecentParshaVideosFromYouTube(apiKey, recentLimit = 10) {
  const all = [], recent = [];
  let pageToken = "";
  while (true) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      `?part=snippet,contentDetails&playlistId=${YT_PLAYLIST_ID}&maxResults=50&pageToken=${pageToken}&key=${apiKey}`;
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
      const obj = { type: "video", program: "Parsha", title: sn.title || "Parsha video", url: `https://www.youtube.com/watch?v=${videoId}`, date: publishedAt };
      all.push(obj);
      if (recent.length < recentLimit) recent.push(obj);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return { all, recent };
}

const PORT = 4173;
const PAGES = ["/parsha.html","/tefilah.html","/halacha.html","/one-minute-audio.html","/mishna.html"];

function parseMmDdYyyy(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1])-1, Number(m[2])));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sortByDateDesc(arr) {
  return (arr||[]).filter(x=>x&&x.date).sort((a,b)=>new Date(b.date)-new Date(a.date));
}

function safeNum(x) { return typeof x==="number"&&Number.isFinite(x)?x:0; }
function norm(s) { return String(s||"").toLowerCase().trim(); }

function flattenHalacha(data) {
  const out = [];
  const pushItem = (it) => {
    if (!it||!it.url) return;
    const date = parseMmDdYyyy(it.note);
    if (!date) return;
    out.push({ type:(it.type||"audio"), program:"Halacha", title:it.title||"Halacha", url:it.url, date });
  };
  for (const cat of data||[]) {
    for (const it of cat.items||[]) pushItem(it);
    for (const sub of cat.subcategories||[]) for (const it of sub.items||[]) pushItem(it);
  }
  return out.filter(x=>x.url&&x.date);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        const filePath = urlPath==="/"?"/index.html":urlPath;
        const { readFile } = await import("node:fs/promises");
        const { extname } = await import("node:path");
        const file = await readFile("."+filePath);
        const ext = extname(filePath).toLowerCase();
        const ct = ext===".html"?"text/html; charset=utf-8":ext===".js"?"text/javascript; charset=utf-8":ext===".json"?"application/json; charset=utf-8":ext===".css"?"text/css; charset=utf-8":"application/octet-stream";
        res.writeHead(200,{"Content-Type":ct});
        res.end(file);
      } catch { res.writeHead(404); res.end("Not found"); }
    });
    server.listen(PORT, ()=>resolve(server));
  });
}

async function waitForReadyFlag(page) {
  try {
    await page.waitForFunction(()=>{
      const p=location.pathname.toLowerCase();
      if(p.includes("parsha")) return window.__COUNTS_READY__?.parsha===true;
      if(p.includes("tefilah")) return window.__COUNTS_READY__?.tefila===true;
      if(p.includes("one-minute")) return window.__COUNTS_READY__?.oneMinute===true;
      return true;
    },{timeout:20000});
  } catch {}
}

async function readHalachaTotalAllFromDom(page) {
  await page.waitForSelector("#halachaTotalAll[data-total]",{timeout:20000,state:"attached"});
  const n = await page.locator("#halachaTotalAll").evaluate(el=>Number(el.getAttribute("data-total")||el.dataset.total||"0"));
  if(!Number.isFinite(n)||n<0) throw new Error(`Invalid halacha totalAll: ${n}`);
  return n;
}

(async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1) One-Minute JSON
  let oneMinItems = [];
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/data.json`);
    const oneMin = await res.json();
    oneMinItems = Array.isArray(oneMin)?oneMin:oneMin.items||[];
  } catch(e) { console.warn("One-Minute data.json failed:", String(e)); }

  // 2) Breakdown from pages
  const breakdown = { parsha:{audio:null,video:null}, tefila:{video:null}, halacha:{totalAll:null}, oneMinute:{audio:null}, mishna:{audio:null} };

  for (const path of PAGES) {
    try {
      await page.goto(`http://127.0.0.1:${PORT}${path}`,{waitUntil:"load",timeout:60000});
      await waitForReadyFlag(page);
      const snap = await page.evaluate(()=>({
        breakdown: window.SITE_COUNTS?.allShiurim?.breakdown||null,
        tmCounts: window.TM_COUNTS||null,
      }));
      console.log("SNAP", path, JSON.stringify(snap));
      const b = snap.breakdown;
      if(b?.parsha) {
        if(typeof b.parsha.audio==="number") breakdown.parsha.audio=b.parsha.audio;
        if(typeof b.parsha.video==="number") breakdown.parsha.video=b.parsha.video;
      }
      if(b?.tefila&&typeof b.tefila.video==="number") breakdown.tefila.video=b.tefila.video;
      if(b?.oneMinute&&typeof b.oneMinute.audio==="number") breakdown.oneMinute.audio=b.oneMinute.audio;
      if(path.includes("halacha")) { breakdown.halacha.totalAll=await readHalachaTotalAllFromDom(page); console.log("HALACHA totalAll:",breakdown.halacha.totalAll); }
      if(path.includes("mishna")) { const n=Number(snap.tmCounts?.total_items??0); if(!Number.isFinite(n)||n<0) throw new Error(`Invalid mishna: ${snap.tmCounts?.total_items}`); breakdown.mishna.audio=n; console.log("MISHNA audio:",breakdown.mishna.audio); }
    } catch(e) { console.warn("Skipping", path, String(e)); }
  }

  breakdown.oneMinute.audio = oneMinItems.length;

  // 3) YouTube — graceful fallback on quota/error
  let allParshaVideos = [], recentParsha = [], youtubeSucceeded = false;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("Missing YOUTUBE_API_KEY — skipping YouTube fetch");
  } else {
    try {
      const { all, recent } = await getAllAndRecentParshaVideosFromYouTube(apiKey, 10);
      allParshaVideos=all; recentParsha=recent; breakdown.parsha.video=all.length;
      youtubeSucceeded=true;
      console.log("YouTube Parsha video count:", breakdown.parsha.video);
    } catch(e) {
      console.warn("YouTube fetch failed — preserving cached data:", String(e));
    }
  }

  // If YouTube failed, read cached parsha data from existing files
  let existingParshaRecent = [], existingIndexParsha = [];
  if (!youtubeSucceeded) {
    try {
      const { readFileSync } = await import("node:fs");
      const existing = JSON.parse(readFileSync("./data/site-counts.json","utf8"));
      existingParshaRecent = existing?.recentByProgram?.parsha||[];
      if(!safeNum(breakdown.parsha.video)&&safeNum(existing?.allShiurim?.breakdown?.parsha?.video)) {
        breakdown.parsha.video = existing.allShiurim.breakdown.parsha.video;
      }
      console.log("Preserved cached parsha video count:", breakdown.parsha.video, "recent:", existingParshaRecent.length);
    } catch(e) { console.warn("Could not read existing site-counts.json:", String(e)); }
    try {
      const { readFileSync } = await import("node:fs");
      const existing = JSON.parse(readFileSync("./data/search-index.json","utf8"));
      existingIndexParsha = (existing||[]).filter(x=>x.program==="Parsha");
      console.log("Preserved", existingIndexParsha.length, "Parsha entries in search index");
    } catch(e) { console.warn("Could not read existing search-index.json:", String(e)); }
  }

  // 4) Recents
  let recentHalacha=[], recentOneMin=[];
  try {
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`,{waitUntil:"load"});
    const halachaData = await page.evaluate(()=>{ if(window.HALACHA_DATA) return window.HALACHA_DATA; if(typeof PAGE_DATA!=="undefined") return PAGE_DATA; return null; });
    recentHalacha = flattenHalacha(halachaData);
  } catch(e) { console.warn("Recent Halacha failed:", String(e)); }

  try {
    recentOneMin = (oneMinItems||[]).map((x,i)=>({ type:"audio", program:"One-Minute", title:x.description||x.filename||"One-Minute Audio", url:x.url, date:parseMmDdYyyy(x.date) })).filter(x=>x.url&&x.date);
  } catch(e) { console.warn("Recent One-Minute failed:", String(e)); }

  recentHalacha=sortByDateDesc(recentHalacha);
  recentOneMin=sortByDateDesc(recentOneMin);
  recentParsha=sortByDateDesc(recentParsha);
  const recent=sortByDateDesc([...recentHalacha,...recentOneMin,...recentParsha]).slice(0,5);

  // 5) Write site-counts.json
  const out = {
    allShiurim: {
      total: safeNum(breakdown.parsha.audio)+safeNum(breakdown.parsha.video)+safeNum(breakdown.tefila.video)+safeNum(breakdown.halacha.totalAll)+safeNum(breakdown.oneMinute.audio)+safeNum(breakdown.mishna.audio),
      breakdown,
      updated: new Date().toISOString().slice(0,10),
    },
    recent,
    recentByProgram: {
      oneMinute: recentOneMin.slice(0,10),
      halacha:   recentHalacha.slice(0,10),
      parsha:    youtubeSucceeded ? recentParsha.slice(0,10) : existingParshaRecent,
    },
  };
  writeFileSync("./data/site-counts.json", JSON.stringify(out,null,2)+"\n","utf8");
  console.log("Wrote data/site-counts.json:", out.allShiurim);

  // 6) Write search-index.json
  let allHalacha=[];
  try {
    await page.goto(`http://127.0.0.1:${PORT}/halacha.html`,{waitUntil:"load"});
    const halachaData = await page.evaluate(()=>{ if(window.HALACHA_DATA) return window.HALACHA_DATA; if(typeof PAGE_DATA!=="undefined") return PAGE_DATA; return null; });
    allHalacha=flattenHalacha(halachaData);
    console.log("FOUND in allHalacha?", allHalacha.some(x=>x.title==="The risk of NOT saying Hallel on Yom Haatzmaut"));
  } catch(e) { console.warn("Halacha index build failed:", String(e)); }

  const indexOneMin = (oneMinItems||[]).map((x,i)=>({ id:`one-${x.id??i}`, program:"One-Minute", type:"audio", title:x.description||x.filename||"One-Minute Audio", url:x.url, date:parseMmDdYyyy(x.date), page:"/one-minute-audio.html" })).filter(x=>x.url&&x.title);
  const indexHalacha = (allHalacha||[]).map((x,i)=>({ id:`hal-${i}`, program:"Halacha", type:x.type||"audio", title:x.title||"Halacha", url:x.url, date:x.date, page:"/halacha.html" })).filter(x=>x.url&&x.title);
  const indexParsha = youtubeSucceeded
    ? (allParshaVideos||[]).map(x=>({ id:`par-${x.url.split("v=")[1]||x.date||Math.random().toString(16).slice(2)}`, program:"Parsha", type:"video", title:x.title||"Parsha video", url:x.url, date:x.date, page:"/parsha.html" })).filter(x=>x.url&&x.title)
    : existingIndexParsha;

  const searchIndex = [...indexOneMin,...indexHalacha,...indexParsha].map(x=>({...x,title_lc:norm(x.title)}));
  console.log("FOUND in searchIndex?", searchIndex.some(x=>x.title==="The risk of NOT saying Hallel on Yom Haatzmaut"));
  writeFileSync("./data/search-index.json", JSON.stringify(searchIndex,null,2)+"\n","utf8");
  console.log("Wrote data/search-index.json:", searchIndex.length);

  await browser.close();
  server.close();
})();
