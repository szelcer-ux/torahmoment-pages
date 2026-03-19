import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SEARCH_INDEX_PATH = path.join(DATA_DIR, "search-index.json");
const OUT_PATH = path.join(DATA_DIR, "weekly-update.json");

function parseItemDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function getRollingWeekRange() {
  const now = new Date();
  const end = endOfDayLocal(now);

  const startBase = new Date(now);
  startBase.setDate(startBase.getDate() - 6);

  const start = startOfDayLocal(startBase);
  return { start, end };
}

function formatRangeLabel(start, end) {
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long" });
  const dayFmt = new Intl.DateTimeFormat("en-US", { day: "numeric" });
  const fullFmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const startMonth = monthFmt.format(start);
  const endMonth = monthFmt.format(end);
  const startDay = dayFmt.format(start);
  const endDay = dayFmt.format(end);
  const endYear = new Intl.DateTimeFormat("en-US", { year: "numeric" }).format(end);

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}, ${endYear}`;
  }

  return `${fullFmt.format(start)}–${fullFmt.format(end)}`;
}

function normalizeProgram(program = "") {
  const p = String(program).trim().toLowerCase();

  if (p.includes("parsha")) return "parsha";
  if (p.includes("halacha") || p.includes("hashkafa")) return "halacha";
  if (p.includes("one-minute") || p.includes("one minute")) return "oneMinute";

  return null;
}

function groupLabel(key) {
  switch (key) {
    case "parsha": return "Parsha";
    case "halacha": return "Halacha / Hashkafa";
    case "oneMinute": return "One-Minute Audio";
    default: return "";
  }
}

function cleanItem(item) {
  return {
    id: item.id || "",
    title: item.title || "Untitled",
    program: item.program || "",
    type: item.type || "",
    date: item.date || "",
    page: item.page || "#",
    url: item.url || ""
  };
}

function sortNewestFirst(a, b) {
  return parseItemDate(b.date) - parseItemDate(a.date);
}

function pickFeatured(items) {
  const parshaItems = items.filter(x => normalizeProgram(x.program) === "parsha");
  if (parshaItems.length) return parshaItems[0];
  return items[0] || null;
}

async function main() {
  const raw = await fs.readFile(SEARCH_INDEX_PATH, "utf8");
  const allItems = JSON.parse(raw);

  if (!Array.isArray(allItems)) {
    throw new Error("search-index.json must be an array");
  }

  const { start, end } = getRollingWeekRange();

  const weeklyItems = allItems
    .filter(item => {
      const key = normalizeProgram(item.program);
      if (!key) return false;

      const d = parseItemDate(item.date);
      return d && d >= start && d <= end;
    })
    .sort(sortNewestFirst);

  const groupedMap = new Map();

  for (const item of weeklyItems) {
    const key = normalizeProgram(item.program);
    if (!key) continue;
    if (!groupedMap.has(key)) groupedMap.set(key, []);
    groupedMap.get(key).push(cleanItem(item));
  }

  const orderedKeys = ["parsha", "halacha", "oneMinute"];

  const groups = orderedKeys
    .filter(key => groupedMap.has(key))
    .map(key => ({
      key,
      label: groupLabel(key),
      items: groupedMap.get(key)
    }));

  const featured = pickFeatured(weeklyItems);

  const output = {
    rangeLabel: formatRangeLabel(start, end),
    generatedAt: new Date().toISOString(),
    totalItems: weeklyItems.length,
    featured: featured ? cleanItem(featured) : null,
    groups
  };

  await fs.writeFile(OUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${OUT_PATH} with ${weeklyItems.length} items`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
