// /data/site-counts.js
// Start simple (manual). We'll automate piece-by-piece later.

window.SITE_COUNTS = window.SITE_COUNTS || {};

window.SITE_COUNTS.allShiurim = {
  total: null,            // number when ready
  breakdown: {
    parsha: { audio: null, video: null },
    tefila: { video: null },
    halacha: { audio: null },
    oneMinute: { audio: null }
  },
  updated: null           // e.g. "2026-01-29"
};


window.SITE_COUNTS.allShiurim.total = 1234;
window.SITE_COUNTS.allShiurim.updated = "2026-01-29";
